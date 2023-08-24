import {
	OutputSchema as RepoEvent,
	isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { Record as PostRecord } from './lexicon/types/app/bsky/feed/post'
import { Record as LikeRecord } from './lexicon/types/app/bsky/feed/like'
import { Record as RepostRecord } from './lexicon/types/app/bsky/feed/repost'
import {
	CreateOp,
	DeleteOp,
	FirehoseSubscriptionBase,
	getOpsByType,
} from './util/subscription'
import { Database } from './db'

async function createLike(db: Database, op: CreateOp<LikeRecord>) {
	await db
		.updateTable('post')
		.where('postUri', '=', op.record.subject.uri)
		.set(({ eb }) => ({ votes: eb.bxp('votes', '+', 1) }))
		.execute()
}

async function deleteLike(db: Database, op: DeleteOp) {
	await db
		.updateTable('post')
		.where('postUri', '=', op.uri)
		.set(({ eb }) => ({ votes: eb.bxp('votes', '-', 1) }))
		.execute()
}

async function createPost(db: Database, op: CreateOp<PostRecord>) {
	const findRecorder = await db
		.selectFrom('user')
		.select('uri')
		.where('uri', '=', op.author)
		.execute()

	if (findRecorder.length > 0) {
		await db
			.insertInto('post')
			.values({
				uri: op.uri,
				contributor: op.author,

				postUri: op.uri,
				author: op.author,

				isoTime: new Date().toISOString(),
				votes: 0,
			})
			.execute()
	}
}

async function deletePost(db: Database, op: DeleteOp) {
	await db.deleteFrom('post').where('postUri', '=', op.uri).execute()
}

async function createRepost(db: Database, op: CreateOp<RepostRecord>) {
	const findRecorder = await db
		.selectFrom('user')
		.select('uri')
		.where('uri', '=', op.author)
		.execute()

	const contributor = op.author
	const author = op.record.subject.uri.replace('at://', '').split('/')[0]

	if (findRecorder.length > 0 && contributor !== author) {
		await db
			.insertInto('post')
			.values({
				uri: op.uri,
				contributor,

				postUri: op.record.subject.uri,
				author,

				isoTime: new Date().toISOString(),
				votes: 0,
			})
			.execute()
	}
}

async function deleteRepost(db: Database, op: DeleteOp) {
	await db.deleteFrom('post').where('uri', '=', op.uri).execute()
}

let i = 0

export class FirehoseSubscription extends FirehoseSubscriptionBase {
	async handleEvent(evt: RepoEvent) {
		if (i++ > 10000) {
			console.log('ping', new Date().toISOString())
			i = 0
		}

		if (!isCommit(evt)) return

		const ops = await getOpsByType(evt)

		//process.stdout.write('.')

		ops.likes.creates.forEach(createLike.bind(null, this.db))
		ops.likes.deletes.forEach(deleteLike.bind(null, this.db))

		ops.posts.creates.forEach(createPost.bind(null, this.db))
		ops.posts.deletes.forEach(deletePost.bind(null, this.db))

		ops.reposts.creates.forEach(createRepost.bind(null, this.db))
		ops.reposts.deletes.forEach(deleteRepost.bind(null, this.db))
	}
}
