import { AtpAgent } from '@atproto/api'
import 'isomorphic-fetch'
import xrpc from '@atproto/xrpc'

import { differenceInMilliseconds } from 'date-fns'
import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { schemas } from '../lexicon/lexicons'
import { Database } from '../db'

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

export const handler = async (ctx: AppContext, params: QueryParams) => {
	const { db } = ctx
	refreshLocalForUser(ctx, params).catch(
		console.error.bind(null, 'refreshLocalForUser'),
	)

	const start = new Date()

	const [{ totalUsers }] = await db
		.selectFrom('user')
		.select((eb) => [eb.fn.count<number>('uri').as('totalUsers')])
		.execute()

	const [{ usersCount, postsCount, postVotesAvg }] = await db
		.selectFrom('post')
		.select((eb) => [
			eb.fn.count<number>('postUri').as('postsCount'),
			eb.fn.count<number>('poster').distinct().as('usersCount'),
			eb.fn.avg<number>('votes').as('postVotesAvg'),
		])
		.execute()

	const userPostsAvg = postsCount / usersCount

	const network = {
		usersCount,
		postsCount,
		userPostsAvg,
		postVotesAvg,
		totalUsers,
	}

	const feedData = await db
		.selectFrom('follow')
		.where('follower', '=', params.requesterDid)
		.innerJoin('post', 'follow.followed', 'post.recorder')
		.innerJoin('post as otherPosts', 'post.poster', 'otherPosts.poster')
		.groupBy('post.postUri')
		.select((eb) => [
			'post.recordUri as post',
			'post.isoTime',
			'post.votes',
			eb.fn.count<number>('otherPosts.postUri').as('postsByUser'),
			eb.fn.avg<number>('otherPosts.votes').as('postersAverageVotes'),
		])
		.where('post.isoTime', '<', params.cursor ?? start.toISOString())
		.orderBy('post.isoTime', 'desc')
		.limit(30)
		.execute()

	const cursor = (feedData ?? []).at(-1)?.isoTime ?? undefined

	const feed = feedData.filter(({ isoTime, ...item }) => {
		const userNormalizedPostRate = item.postsByUser / userPostsAvg
		const postNormalizedVotes =
			item.votes / (item.postersAverageVotes ?? 1) || 1
		const isBanger = userNormalizedPostRate - 1 < postNormalizedVotes

		return isBanger
	})

	const end = new Date()

	return {
		cursor,
		doneIn: differenceInMilliseconds(end, start) + 'ms',
		network,
		feed,
	}
}
