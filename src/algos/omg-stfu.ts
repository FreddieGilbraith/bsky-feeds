import { AtpAgent } from '@atproto/api'
import 'isomorphic-fetch'
import xrpc from '@atproto/xrpc'

import { differenceInMilliseconds } from 'date-fns'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { schemas } from '../lexicon/lexicons'

// max 15 chars
export const shortname = 'omg-stfu'

xrpc.addLexicons(schemas)

async function getFollows(
	agent: AtpAgent,
	params: QueryParams,
	queryCursor: string | null = null,
): Promise<Array<string>> {
	const request = {
		repo: params.requesterDid,
		collection: 'app.bsky.graph.follow',
		limit: 30,
		...(queryCursor ? { cursor: queryCursor } : {}),
	}

	const {
		data: { records, cursor = null },
	} = await agent.com.atproto.repo.listRecords(request)

	const follows = records.map((record: any) => record.value.subject)

	if (follows.length === 30) {
		return [...follows, ...(await getFollows(agent, params, cursor))]
	} else {
		return follows
	}
}

async function refreshLocalForUser(ctx: AppContext, params: QueryParams) {
	const { db, agent } = ctx
	const follower = params.requesterDid
	try {
		const [follows] = await Promise.all([
			getFollows(agent, params),
			db
				.selectFrom('follow')
				.select('followed')
				.where('follower', '=', follower)
				.execute(),
		])

		if (follows.length > 0) {
			const addFollowers = db
				.insertInto('follow')
				.onConflict((oc) => oc.doNothing())
				.values(
					follows.map((followed: string) => ({
						followed,
						follower: params.requesterDid,
					})),
				)

			const addUsers = db
				.insertInto('user')
				.onConflict((oc) => oc.doNothing())
				.values(
					[follower, ...follows].map((uri: string, i) => ({
						uri,
						interest: i === 0 ? 2 : 1,
					})),
				)

			await Promise.all([addFollowers.execute(), addUsers.execute()])
		}
	} catch (e) {
		console.error('refreshLocalForUser', e)
	}
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const start = new Date()
	const out = await fn()
	const end = new Date()
	console.log(label, differenceInMilliseconds(end, start), 'ms')
	return out
}

export const handler = async (ctx: AppContext, params: QueryParams) => {
	const { db } = ctx
	refreshLocalForUser(ctx, params).catch(
		console.error.bind(null, 'refreshLocalForUser'),
	)

	const start = new Date()

	const [{ usersCount, postsCount }] = await db
		.selectFrom('post')
		.select((eb) => [
			eb.fn.count<number>('postUri').as('postsCount'),
			eb.fn.count<number>('author').distinct().as('usersCount'),
		])
		.execute()

	const userPostsAvg = postsCount / usersCount

	const [usersData, postsData] = await Promise.all([
		db
			.selectFrom('follow')
			.where('follower', '=', params.requesterDid)
			.innerJoin('post', 'follow.followed', 'post.contributor')
			.groupBy('post.contributor')
			.select((eb) => [
				'followed as contributor',
				eb.fn.count<number>('post.postUri').as('postsByUser'),
				eb.fn.avg<number>('post.votes').as('postersAverageVotes'),
			])
			.execute(),

		db
			.selectFrom('follow')
			.where('follower', '=', params.requesterDid)
			.innerJoin('post', 'follow.followed', 'post.contributor')
			.select([
				'followed as contributor',
				'post.uri as uri',
				'post.postUri as post',
				'post.isoTime',
				'post.votes',
			])
			.where('post.isoTime', '<', params.cursor ?? start.toISOString())
			.orderBy('post.isoTime', 'desc')
			.limit(params.limit ?? 30)
			.execute(),
	])

	const users = Object.fromEntries(
		usersData.map((user) => [user.contributor, user]),
	)

	const posts = postsData.map((post) => ({
		...post,
		...users[post.contributor],
	}))

	const cursor = (posts ?? []).at(-1)?.isoTime ?? undefined

	const feed = posts
		.map(({ isoTime, ...item }) => {
			const userNormalizedPostRate = item.postsByUser / userPostsAvg
			const postNormalizedVotes =
				item.votes / (item.postersAverageVotes ?? 1) || 1
			const isBanger = userNormalizedPostRate - 1 < postNormalizedVotes

			return {
				...item,
				isoTime,
				isBanger,
				userNormalizedPostRate,
				postNormalizedVotes,
			}
		})
		.map((post) => ({
			...post,
			...(post.post !== post.uri
				? {
						reason: {
							$type: 'app.bsky.feed.defs#skeletonReasonRepost',
							repost: post.uri,
						},
				  }
				: {}),
		}))
		.filter((post) => post.isBanger)
		.map(({ post, reason }) => ({
			post,
			reason,
		}))

	const end = new Date()

	console.log('took', differenceInMilliseconds(end, start), 'ms')

	return {
		cursor,
		feed,
	}
}
