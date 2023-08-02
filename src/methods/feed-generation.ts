import { InvalidRequestError } from '@atproto/xrpc-server'
import { Server } from '../lexicon'
import { AppContext } from '../config'
import algos from '../algos'
import { validateAuth } from '../auth'
import { AtUri } from '@atproto/uri'

export default function (server: Server, ctx: AppContext) {
	server.app.bsky.feed.getFeedSkeleton(async ({ params, req }) => {
		const feedUri = new AtUri(params.feed)
		const algo = algos[feedUri.rkey]
		if (
			feedUri.hostname !== ctx.cfg.publisherDid ||
			feedUri.collection !== 'app.bsky.feed.generator' ||
			!algo
		) {
			throw new InvalidRequestError(
				'Unsupported algorithm',
				'UnsupportedAlgorithm',
			)
		}

		const requesterDid = await validateAuth(
			req,
			ctx.cfg.serviceDid,
			ctx.didResolver,
		).catch(() => 'did:plc:wlgerp2not5oct7twfq2teyg')

		const body = await algo(ctx, {
			...params,
			requesterDid,
			authorization: req.headers.authorization,
		})

		return {
			encoding: 'application/json',
			body: body,
		}
	})
}
