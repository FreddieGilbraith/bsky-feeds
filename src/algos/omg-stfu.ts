import { AtpAgent } from '@atproto/api'
import 'isomorphic-fetch'
import xrpc from '@atproto/xrpc'
import { sql } from 'kysely'

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

	console.log({ userPostsAvg, postsCount, usersCount })

	const usersQuery = db
		.selectFrom('follow')
		.where('follower', '=', params.requesterDid)
		.innerJoin('post', 'follow.followed', 'post.contributor')
		.groupBy('post.contributor')
		.select(({ eb }) => [
			'followed as contributor',
			eb.fn.count<number>('post.postUri').as('postsByUser'),
			eb.fn.avg<number>(sql`ln(post.votes)`).as('votesAvg'),
			eb(eb.fn.count<number>('post.postUri'), '/', userPostsAvg).as('postRate'),
		])
	//console.log(usersQuery.compile().sql)
	const usersData = await usersQuery.execute()

	const users = Object.fromEntries(
		usersData
			.map(({ votesAvg, postRate, ...user }) => ({
				...user,
				votesAvg: Math.pow(Math.E, votesAvg),
				postRate: Math.log(postRate),
			}))
			.map((user) => [user.contributor, user]),
	)

	const mostProloficPosters = Object.values(users)
		.sort((a, b) => b.postRate - a.postRate)
		.slice(0, Math.floor(Math.log(usersData.length)))

	const postsData = await db
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
		.execute()

	//console.log('rare', users['did:plc:psyip2d7nquum47ova4isnvu']) // Rare
	//console.log('JSON Schreirir', users['did:plc:2mkgbhbhqvappkkorf2bzyrp']) // JSON Shcrier
	//console.log('Average', users['did:plc:xwz5k4wh527nlcxqeezrwxaa']) // avg
	//console.log('Da King of Kings', users['did:plc:ssswl2yqnc4snqvsdu5u7jiq']) // Da King of Kings
	//console.log('Kafui', users['did:plc:533rak3rtsbnvlxytybkdepr']) // Kafui
	//console.log('kat', users['did:plc:pgf2yw2zddrxh5ngapc7rfq6']) // kat

	const postLimit = mostProloficPosters.at(-1)?.postRate ?? 1

	const posts = postsData
		.map((post) => ({
			...post,
			...users[post.author],
		}))
		.map((post) => ({
			...post,
			normalizedVotes: post.votes / post.votesAvg,
		}))
		.map((post) => ({
			...post,
			isBanger: post.postRate - postLimit < post.normalizedVotes,
		}))

	//console.log(
	//posts
	//.slice(0, 5)
	//.map(
	//({
	//post,
	//isoTime,
	//votes,
	//postsByUser,
	//votesAvg,
	//postRate,
	//normalizedVotes,
	//isBanger,
	//}) => ({
	//isoTime,
	//post,
	//votes,
	//votesAvg,
	//normalizedVotes,
	//postsByUser,
	//postRate,
	//isBanger,
	//}),
	//),
	//)

	//const powerPosts = posts.filter(({ contributor }) =>
	//[
	//'did:plc:vwzwgnygau7ed7b7wt5ux7y2',
	//'did:plc:katl2n3xfpfwpv45aiwwtbrb',
	//'did:plc:ssswl2yqnc4snqvsdu5u7jiq',
	//'did:plc:533rak3rtsbnvlxytybkdepr',
	//'did:plc:pgf2yw2zddrxh5ngapc7rfq6',
	//].includes(contributor),
	//).length

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

	//const powerPostsRemaining = filteredFeed.filter(({ contributor }) =>
	//[
	//'did:plc:vwzwgnygau7ed7b7wt5ux7y2',
	//'did:plc:katl2n3xfpfwpv45aiwwtbrb',
	//'did:plc:ssswl2yqnc4snqvsdu5u7jiq',
	//'did:plc:533rak3rtsbnvlxytybkdepr',
	//'did:plc:pgf2yw2zddrxh5ngapc7rfq6',
	//].includes(contributor),
	//).length

	//console.log({
	//feedWithMeta: feedWithMeta.length,
	//powerPosts,
	//filteredFeed: filteredFeed.length,
	//powerPostsRemaining,
	//})

	const limitedFeed = filteredFeed.slice(0, 30)
	const cursor = (limitedFeed ?? []).at(-1)?.isoTime ?? undefined

	const feed = limitedFeed.map(
		({ post, reason, isoTime, votes, postRate, normalizedVotes }) => ({
			post,
			reason,
			isoTime,
			votes,
			postRate,
			normalizedVotes,
		}),
	)

	const end = new Date()

	console.log('took', differenceInMilliseconds(end, start), 'ms')

	return {
		feed,
		cursor,
	}
}
