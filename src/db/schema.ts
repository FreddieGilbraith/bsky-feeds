export type DatabaseSchema = {
	post: Post
	user: User
	follow: Follow
}

export type Post = {
	recordUri: string
	recorder: string

	postUri: string
	poster: string

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
