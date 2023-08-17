import { AtpAgent } from '@atproto/api'
import 'isomorphic-fetch'
import xrpc from '@atproto/xrpc'
import { sql } from 'kysely'

import { differenceInMilliseconds, sub } from 'date-fns'
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

	const response = await agent.com.atproto.repo.listRecords(request)

	const {
		data: { records, cursor = null },
	} = response

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
		const [actualFollows, storedFollows] = await Promise.all([
			getFollows(agent, params),
			db
				.selectFrom('follow')
				.select('followed')
				.where('follower', '=', follower)
				.execute(),
		])

		actualFollows.push(follower)

		const followsToRemove = new Set(storedFollows.map((x) => x.followed))
		for (const actualFollow of actualFollows) {
			followsToRemove.delete(actualFollow)
		}

		if (actualFollows.length > 0) {
			const addFollowers = db
				.insertInto('follow')
				.onConflict((oc) => oc.doNothing())
				.values(
					actualFollows.map((followed: string) => ({
						followed,
						follower: params.requesterDid,
					})),
				)

			const removeFollowers = db
				.deleteFrom('follow')
				.where('follower', '=', params.requesterDid)
				.where('followed', 'in', [...followsToRemove.values()])

			const addUsers = db
				.insertInto('user')
				.onConflict((oc) => oc.doNothing())
				.values(
					[follower, ...actualFollows].map((uri: string, i) => ({
						uri,
						interest: i === 0 ? 2 : 1,
					})),
				)

			await Promise.all([
				addFollowers.execute(),
				addUsers.execute(),
				removeFollowers.execute(),
			])
		}
	} catch (e) {
		console.error('refreshLocalForUser', e)
	}
}

async function cleanupOld(ctx: AppContext) {
	const { db } = ctx

	await db
		.deleteFrom('post')
		.where('isoTime', '<', sub(new Date(), { days: 5 }).toISOString())
		.execute()
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const start = new Date()
	const out = await fn()
	const end = new Date()
	console.log(label, differenceInMilliseconds(end, start), 'ms')
	return out
}

export const handler = async (ctx: AppContext, params: QueryParams) => {
	try {
		const { db } = ctx

		cleanupOld(ctx).catch(console.error.bind(null, 'cleanupOld'))
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

		const usersQuery = db
			.selectFrom('follow')
			.where('follower', '=', params.requesterDid)
			.innerJoin('post', 'follow.followed', 'post.contributor')
			.groupBy('post.contributor')
			.select(({ eb }) => [
				'followed as contributor',
				eb.fn.count<number>('post.postUri').as('postsByUser'),
				eb.fn.avg<number>(sql`ln(post.votes)`).as('votesAvg'),
				eb(eb.fn.count<number>('post.postUri'), '/', userPostsAvg).as(
					'postRate',
				),
			])

		const postsQuery = db
			.selectFrom('follow')
			.where('follower', '=', params.requesterDid)
			.innerJoin('post', 'follow.followed', 'post.contributor')
			.select([
				'followed as contributor',
				'post.author as author',
				'post.uri as uri',
				'post.postUri as post',
				'post.isoTime',
				'post.votes',
			])
			.where('post.isoTime', '<', params.cursor ?? start.toISOString())
			.orderBy('post.isoTime', 'desc')
			.limit((params.limit ?? 30) * 4)

		const [usersData, postsData] = await Promise.all([
			usersQuery.execute(),
			postsQuery.execute(),
		])

		const users = usersData.map(({ votesAvg, postRate, ...user }) => ({
			...user,
			votesAvg: Math.pow(Math.E, votesAvg),
			postRate: Math.log(postRate),
		}))

		const mostProloficPosters = users
			.sort((a, b) => b.postRate - a.postRate)
			.slice(0, Math.floor(Math.log(usersData.length)))

		const postLimit = mostProloficPosters.at(-1)?.postRate ?? 1

		const usersWithThreshold = users.map((user) => ({
			...user,
			votesThreshold: (user.postRate - postLimit) * user.votesAvg,
		}))

		const usersLookup = Object.fromEntries(
			usersWithThreshold.map((user) => [user.contributor, user]),
		)

		const posts = postsData
			.map((post) => ({
				...post,
				...usersLookup[post.author],
			}))
			.map((post) => ({
				...post,
				isBanger: post.votes > post.votesThreshold,
			}))

		const feedWithMeta = posts.map((post) => ({
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

		const filteredFeed = feedWithMeta.filter((post) => post.isBanger)

		const limitedFeed = filteredFeed.slice(0, 30)
		const cursor = (limitedFeed ?? []).at(-1)?.isoTime ?? undefined

		const feed = limitedFeed.map(
			({ post, reason, isoTime, votes, postRate, votesThreshold }) => ({
				post,
				reason,
				isoTime,
				votes,
				postRate,
				votesThreshold,
			}),
		)

		const end = new Date()

		return {
			feed,
			cursor,
			took: differenceInMilliseconds(end, start) + 'ms',
		}
	} catch (e) {
		console.error(e)
		return {
			feed: [],
		}
	}
}
