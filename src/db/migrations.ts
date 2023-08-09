import { Kysely, Migration, MigrationProvider } from 'kysely'

const migrations: Record<string, Migration> = {}

export const migrationProvider: MigrationProvider = {
	async getMigrations() {
		return migrations
	},
}

migrations['001'] = {
	async up(db: Kysely<unknown>) {
		await db.schema
			.createTable('post')
			.addColumn('recordUri', 'varchar', (col) => col.primaryKey().unique())
			.addColumn('recorder', 'varchar', (col) => col.notNull())
			.addColumn('postUri', 'varchar', (col) => col.notNull())
			.addColumn('poster', 'varchar', (col) => col.notNull())
			.addColumn('isoTime', 'varchar', (col) => col.notNull())
			.addColumn('votes', 'integer', (col: any) => col.notNull())
			.execute()

		await db.schema
			.createTable('user')
			.addColumn('uri', 'varchar', (col: any) => col.primaryKey().unique())
			.addColumn('interest', 'integer', (col: any) => col.defaultTo(0))
			.execute()

		await db.schema
			.createTable('follow')
			.addColumn('followed', 'varchar', (col: any) => col)
			.addColumn('follower', 'varchar', (col: any) => col)
			.addUniqueConstraint('follow_unique', ['followed', 'follower'])
			.execute()
	},

	async down(db: Kysely<unknown>) {
		await db.schema.dropTable('post').execute()
		await db.schema.dropTable('user').execute()
		await db.schema.dropTable('follow').execute()
	},
}

migrations['002'] = {
	async up(db: Kysely<unknown>) {
		await db.schema
			.alterTable('post')
			.renameColumn('recordUri', 'uri')
			.execute()

		await db.schema
			.alterTable('post')
			.renameColumn('recorder', 'contributor')
			.execute()

		await db.schema
			.alterTable('post')
			.renameColumn('poster', 'author')
			.execute()
	},

	async down(db: Kysely<unknown>) {
		await db.schema
			.alterTable('post')
			.renameColumn('uri', 'recordUri')
			.execute()

		await db.schema
			.alterTable('post')
			.renameColumn('author', 'poster')
			.execute()

		await db.schema
			.alterTable('post')
			.renameColumn('contributor', 'recorder')
			.execute()
	},
}

//migrations['003'] = {
//async up(db: Kysely<unknown>) {
//await db.schema
//.createIndex('idx_001')
//.on('post')
//.column('contributor')
//.column('isoTime')
//.execute()
//},

//async down(db: Kysely<unknown>) {
//},
//}
