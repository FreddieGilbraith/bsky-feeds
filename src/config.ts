import { Database } from './db'
import { DidResolver } from '@atproto/did-resolver'
import { AtpAgent } from '@atproto/api'

export type AppContext = {
	db: Database
	didResolver: DidResolver
	cfg: Config
	agent: AtpAgent
}

export type Config = {
	port: number
	listenhost: string
	hostname: string
	sqliteLocation: string
	subscriptionEndpoint: string
	serviceDid: string
	publisherDid: string
	subscriptionReconnectDelay: number
	bskyServiceUrl: string
	handle: string
	appPassword: string
}
