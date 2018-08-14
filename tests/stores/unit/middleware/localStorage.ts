import global from '../../../../src/shim/global';
const { describe, it, beforeEach } = intern.getInterface('bdd');
const { assert } = intern.getPlugin('chai');

import { collector, load } from './../../../../src/stores/middleware/localStorage';
import { Store } from './../../../../src/stores/Store';
import { CommandRequest, createProcess } from '../../../../src/stores/process';
import { PatchOperation, OperationType } from '../../../../src/stores/state/Patch';
import { Pointer } from '../../../../src/stores/state/Pointer';

function incrementCounter({ get, path }: CommandRequest<{ counter: number }>): PatchOperation[] {
	let counter = get(path('counter')) || 0;
	return [{ op: OperationType.REPLACE, path: new Pointer('/counter'), value: ++counter }];
}

const LOCAL_STORAGE_TEST_ID = 'local-storage-id';

if (!global.localStorage) {
	global.localStorage = {
		storage: {},
		getItem(this: any, key: string) {
			return this.storage[key];
		},
		setItem(this: any, key: string, item: string) {
			this.storage[key] = item;
		},
		removeItem(this: any, key: string) {
			delete this.storage[key];
		}
	};
}

let store: Store;

describe('middleware - local storage', () => {
	beforeEach(() => {
		global.localStorage.removeItem(LOCAL_STORAGE_TEST_ID);
		store = new Store();
	});

	it('Should save state to local storage', () => {
		const incrementCounterProcess = createProcess(
			'increment',
			[incrementCounter],
			collector(LOCAL_STORAGE_TEST_ID, (path) => [path('counter')])
		);
		incrementCounterProcess(store)({});
		assert.deepEqual(
			global.localStorage.getItem(LOCAL_STORAGE_TEST_ID),
			'[{"meta":{"path":"/counter"},"state":1}]'
		);
	});

	it('Should call next middleware', () => {
		let composedMiddlewareCalled = false;
		const incrementCounterProcess = createProcess(
			'increment',
			[incrementCounter],
			collector(
				LOCAL_STORAGE_TEST_ID,
				(path) => [path('counter')],
				(error, result) => {
					composedMiddlewareCalled = true;
				}
			)
		);
		incrementCounterProcess(store)({});
		assert.isTrue(composedMiddlewareCalled);
	});

	it('should load from local storage', () => {
		global.localStorage.setItem(LOCAL_STORAGE_TEST_ID, '[{"meta":{"path":"/counter"},"state":1}]');
		load(LOCAL_STORAGE_TEST_ID, store);
		assert.deepEqual((store as any)._state, { counter: 1 });
	});

	it('should not load anything or throw an error if data does exist', () => {
		global.localStorage.setItem('other-storage-id', '[{"meta":{"path":"/counter"},"state":1}]');
		load(LOCAL_STORAGE_TEST_ID, store);
		assert.deepEqual((store as any)._state, {});
	});
});
