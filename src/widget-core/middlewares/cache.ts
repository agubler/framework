import { middleware } from '../tsx';
import Map from '../../shim/Map';

const createFactory = middleware<{ foo: string }>();

const cacheMap = new Map<string, any>();

export const cache = createFactory({}, ({ id }) => {
	return {
		get<T>(): T | null {
			return cacheMap.get(id);
		},
		set<T>(item: T): void {
			cacheMap.set(id, item);
		}
	};
});

export default cache;
