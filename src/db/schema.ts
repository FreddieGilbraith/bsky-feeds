export type DatabaseSchema = {
	post: Post
	user: User
	follow: Follow
	app: AppState
}

export type Post = {
	uri: string
	contributor: string

	postUri: string
	author: string

	isoTime: string
	votes: number
}

export type User = {
	uri: string
	interest: number
}

export type Follow = {
	followed: string
	follower: string
}

export type AppState = {
	service: string
	cursor: number
}
