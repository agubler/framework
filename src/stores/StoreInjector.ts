import { Store } from './Store';
import { Registry } from '../core/Registry';
import { RegistryLabel } from '../core/interfaces';

export interface StoreInjectorOptions {
	key?: RegistryLabel;
	registry?: Registry;
}

export function registerStoreInjector<T>(store: Store<T>, options: StoreInjectorOptions = {}) {
	const { key = 'state', registry = new Registry() } = options;

	if (registry.hasInjector(key)) {
		throw new Error(`Store has already been defined for key ${key.toString()}`);
	}
	registry.defineInjector(key, () => {
		return () => store;
	});
	return registry;
}
