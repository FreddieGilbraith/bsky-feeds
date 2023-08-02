import { AppContext } from '../config'
import {
	QueryParams,
	OutputSchema as AlgoOutput,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import * as omgStfu from './omg-stfu'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

const algos: Record<string, AlgoHandler> = {
	[omgStfu.shortname]: omgStfu.handler,
}

export default algos
