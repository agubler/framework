import { WidgetMetaProperties, MetaBase } from '../widget-core/interfaces';
import Store from './Store';
import { uuid } from '../core/util';
import fetch from '../shim/fetch';
import { createProcess, createCommandFactory } from './process';
import { replace, remove } from './state/operations';
import { Destroyable } from '../core/Destroyable';

const createCommand = createCommandFactory<any>();

export interface ResourceMeta<S> extends MetaBase {
	getOrRead(): S[];
	getOrRead(id: string): S;
	status(options: { id?: string; action?: string }): any;
}

export interface Resource<S> {
	new (args: any): ResourceMeta<S>;
	update(payload: Partial<S>): void;
	delete(id: string): void;
	create(resource: Partial<S>): void;
}

export interface ResourceResponse<S> {
	payload?: S;
	status: ResourceResponseStatus;
}

export interface ResourceConfig<S> {
	idKey?: string;
	template(resource: Partial<S>): S;
	create(item: Partial<S> | Partial<S>[]): Promise<ResourceResponse<S>> | Promise<ResourceResponse<S[]>>;
	update(item: Partial<S> | Partial<S>[]): Promise<ResourceResponse<S>> | Promise<ResourceResponse<S[]>>;
	read(id?: string): Promise<ResourceResponse<S>> | Promise<ResourceResponse<S[]>>;
	delete(id: string): Promise<ResourceResponse<S>>;
}

export enum ResourceResponseStatus {
	failed = 0,
	success = 1,
	unsupported = 2
}

export interface ResourceUrlOptions {
	origin: string;
	name: string;
	id?: string;
}

export interface ResourceOperationsConfig {
	optimistic: true;
	verb: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
	url: ResourceUrlFunction;
}

export interface ResourceUrlFunction {
	(options: ResourceUrlOptions): string;
}

export interface ResourceOperations {
	read: false | ResourceOperationsConfig;
	create: false | ResourceOperationsConfig;
	update: false | ResourceOperationsConfig;
	delete: false | ResourceOperationsConfig;
}

export interface RestResource<S> {
	origin: string;
	name: string;
	idKey?: string;
	template?(resource: Partial<S>): S;
	one?: ResourceOperations;
	many?: ResourceOperations;
}

const DEFAULT_REST_CONFIG: {
	one: ResourceOperations;
	many: ResourceOperations;
} = {
	one: {
		read: {
			optimistic: true,
			verb: 'GET',
			url: ({ origin, name, id }) => `${origin}/${name}/${id}`
		},
		create: false,
		update: false,
		delete: false
	},
	many: {
		read: {
			optimistic: true,
			verb: 'GET',
			url: ({ origin, name }) => `${origin}/${name}`
		},
		create: false,
		update: false,
		delete: false
	}
};

const a = {
	data: {
		1: { id: 'blah', title: 'title' },
		2: { id: 'foo', title: 'title-2' },
		3: { id: 'bar', title: 'title-3' }
	},
	idMap: {
		blah: '1',
		foo: '2'
	},
	order: {
		'order-id': [2, 3],
		'order-is': 1
	},
	meta: {
		actions: {
			read: {
				one: {
					status: 'loading'
				},
				many: {
					status: 'loading'
				}
			},
			create: {
				one: {
					status: 'loading'
				},
				many: {
					status: 'loading'
				}
			}
		},
		items: {
			'1': {
				status: 'loading',
				action: 'create'
			},
			'2': {
				status: 'failed',
				action: 'create'
			}
		}
	}
};
console.log(a);

const beforeReadMany = createCommand(({ get, path, at, payload }) => {
	const { name, batchId } = payload;

	const currentLoadingCount = get(path(name, 'meta', 'isLoading'));

	return [
		replace(path(name, 'meta', 'isLoading'), currentLoadingCount + 1),
		replace(path(name, 'order', batchId), []),
		replace(path(name, 'meta', 'fetched'), true)
	];
});

const readMany = createCommand(async ({ get, path, at, payload }) => {
	const {
		config: { id, read, template },
		storePath,
		batchId
	} = payload;

	const { payload: readPayload, success } = await read();

	if (!success) {
		const currentFailureCount = get(path(storePath, 'meta', 'isFailed'));
		return [
			replace(path(storePath, 'meta', 'isFailed'), currentFailureCount + 1),
			remove(path(storePath, 'order', batchId)),
			replace(path(storePath, 'meta', 'fetched'), false)
		];
	}
	const batchIds: any[] = [];
	const operations: any[] = [];
	readPayload.forEach((item: any) => {
		const syntheticId = `synth-${uuid()}`;
		batchIds.push(syntheticId);
		operations.push(replace(path(storePath, 'data', syntheticId), template(item)));
		operations.push(replace(path(storePath, 'idMap', `id-${item[id]}`), syntheticId));
	});

	return [...operations, replace(path(storePath, 'order', batchId), batchIds)];
});

const afterReadMany = createCommand(({ get, path, at, payload }) => {
	const { name } = payload;
	const currentLoadingCount = get(path(name, 'meta', 'isLoading'));

	return [
		replace(path(name, 'meta', 'isFailed'), false),
		replace(path(name, 'meta', 'isLoading'), currentLoadingCount - 1)
	];
});

const create = createCommand(async ({ get, path, at, payload }) => {
	const {
		config: { id, create, template },
		items,
		storePath
	} = payload;

	const result = await create(items);

	if (result.status === ResourceResponseStatus.failed) {
		return [];
	}

	if (Array.isArray(result.payload)) {
	} else {
	}

	return [];
});

export function createRestResource<S>(config: RestResource<S>) {
	let {
		idKey = 'id',
		name,
		origin,
		template = (item: S) => {
			return item;
		},
		one = DEFAULT_REST_CONFIG.one,
		many = DEFAULT_REST_CONFIG.many
	} = config;

	one = { ...DEFAULT_REST_CONFIG.one, ...one };
	many = { ...DEFAULT_REST_CONFIG.many, ...many };

	const resourceConfig: ResourceConfig<S> = {
		idKey,
		template,
		async create(item) {
			const createConfig = Array.isArray(item) ? one.create : many.create;
			if (!createConfig) {
				return { status: ResourceResponseStatus.unsupported };
			}
			try {
				const { url, verb } = createConfig;
				const path = url({ origin, name });
				const response = await fetch(path, { method: verb, body: JSON.stringify(item) });
				if (!response.ok) {
					return { status: ResourceResponseStatus.failed };
				}
				const json = await response.json();
				return { payload: json, status: ResourceResponseStatus.success };
			} catch (e) {
				return { status: ResourceResponseStatus.failed };
			}
		},
		async update(item) {
			return { status: ResourceResponseStatus.unsupported };
		},
		async read(id) {
			const readConfig = id ? one.read : many.read;
			if (!readConfig) {
				return { status: ResourceResponseStatus.unsupported };
			}
			try {
				const { url, verb } = readConfig;
				const path = url({ origin, name, id });
				const response = await fetch(path, { method: verb });
				if (!response.ok) {
					return { status: ResourceResponseStatus.failed };
				}
				const json = await response.json();
				return { payload: json, status: ResourceResponseStatus.success };
			} catch (e) {
				return { status: ResourceResponseStatus.failed };
			}
		},
		async delete(item) {
			return { status: ResourceResponseStatus.unsupported };
		}
	};

	return createResource<S>(resourceConfig);
}

export function createResource<S>(config: ResourceConfig<S>) {
	const storePath = `store-${uuid()}`;

	return (store: Store): Resource<S> => {
		const readManyProc = createProcess(`${storePath}-readMany`, [beforeReadMany, readMany, afterReadMany])(store);
		const createProc = createProcess(`${storePath}-create`, [create])(store);

		class R extends Destroyable implements MetaBase {
			constructor(metaProperties: WidgetMetaProperties) {
				super();
				const handle = store.onChange(store.path(storePath), () => {
					metaProperties.invalidate();
				});
				this.own({
					destroy: () => {
						handle.remove();
					}
				});
			}

			static update(item: Partial<S>): void {}

			static delete(id: string): void {}

			static create(item: Partial<S>): void;
			static create(items: Partial<S>[]): void;
			static create(items: Partial<S> | Partial<S>[]): void {
				const { idKey = 'id' } = config;
				if (Array.isArray(items)) {
					items = items.map((item) => {
						(item as any)[idKey] = uuid();
						return item;
					});
				} else {
					(items as any)[idKey] = uuid();
				}

				createProc({ config, items });
			}

			static get(id?: string): void {}

			status(options: { id?: string; action?: string }): any {
				// return { status: 'failed' };
				// return { status: 'loading' };
				// return { status: 'complete' };
			}

			getOrRead(): S[];
			getOrRead(id: string): S;
			getOrRead(id?: string): S | S[] {
				const hasFetched = store.get(store.path(storePath, 'meta', 'fetched')) || false;
				const isFailed = !!store.get(store.path(storePath, 'meta', 'isFailed'));
				if (isFailed) {
					return [];
				}
				if (hasFetched) {
					const itemIds = store.get(store.path(storePath, 'order'));
					const data = store.get(store.path(storePath, 'data'));
					const orderedData: any = [];
					Object.keys(itemIds).forEach((objectKey) => {
						const item = itemIds[objectKey];
						if (Array.isArray(item)) {
							item.forEach((id) => {
								orderedData.push(data[id]);
							});
						} else {
							orderedData.push(data[item]);
						}
					});

					return orderedData;
				}

				readManyProc({ config, storePath, batchId: `batch-${uuid()}` });

				return [];
			}
		}
		return R;
	};
}
