import { v, w } from './d';
import {
	Constructor,
	DNode,
	WidgetResult,
	MiddlewareMap,
	WidgetResultWithMiddleware,
	WidgetCallback,
	UnionToIntersection,
	MiddlewareCallback,
	MiddlewareResult,
	WNodeFactory
} from './interfaces';
import { WNode, VNodeProperties } from './interfaces';

export { v, w } from './d';

declare global {
	namespace JSX {
		type Element = WNode<any>;
		interface ElementAttributesProperty {
			properties: {};
		}
		interface IntrinsicElements {
			[key: string]: VNodeProperties;
		}
	}
}

export const REGISTRY_ITEM = '__registry_item';

export class FromRegistry<P> {
	static type = REGISTRY_ITEM;
	properties: P = {} as P;
	name: string | undefined;
}

export function fromRegistry<P>(tag: string): Constructor<FromRegistry<P>> {
	return class extends FromRegistry<P> {
		properties: P = {} as P;
		static type = REGISTRY_ITEM;
		name = tag;
	};
}

function spreadChildren(children: any[], child: any): any[] {
	if (Array.isArray(child)) {
		return child.reduce(spreadChildren, children);
	} else {
		return [...children, child];
	}
}

export function tsx(tag: any, properties = {}, ...children: any[]): DNode {
	children = children.reduce(spreadChildren, []);
	properties = properties === null ? {} : properties;
	if (typeof tag === 'string') {
		return v(tag, properties, children);
	} else if (tag.type === 'registry' && (properties as any).__autoRegistryItem) {
		const name = (properties as any).__autoRegistryItem;
		delete (properties as any).__autoRegistryItem;
		return w(name, properties, children);
	} else if (tag.type === REGISTRY_ITEM) {
		const registryItem = new tag();
		return w(registryItem.name, properties, children);
	} else {
		return w(tag, properties, children);
	}
}

export function widget(): WidgetResult;
export function widget<T extends MiddlewareMap<any>, MiddlewareProps = T[keyof T]['properties']>(
	middlewares: T
): WidgetResultWithMiddleware<T, MiddlewareProps>;
export function widget<T extends MiddlewareMap<any>, MiddlewareProps = T[keyof T]['properties']>(
	middlewares?: any
): any {
	return function<Props, Children extends DNode[] = DNode[]>(
		callback: WidgetCallback<Props, T, MiddlewareProps>
	): WNodeFactory<{ properties: UnionToIntersection<Props & MiddlewareProps>; children: Children }> {
		const factory = (properties: any, children?: any) => {
			const result = w(callback as any, properties, children);
			(result as any).middlewares = middlewares;
			(callback as any).isWidget = true;
			return result;
		};
		return factory as WNodeFactory<{
			properties: UnionToIntersection<Props & MiddlewareProps>;
			children: Children;
		}>;
	};
}

export function middleware<Props>() {
	function createMiddleware<ReturnValue>(
		callback: MiddlewareCallback<Props, {}, ReturnValue>
	): MiddlewareResult<Props, {}, ReturnValue>;
	function createMiddleware<
		ReturnValue,
		Middleware extends MiddlewareMap<any>,
		MiddlewareProps = Middleware[keyof Middleware]['properties']
	>(
		middlewares: Middleware,
		callback: MiddlewareCallback<UnionToIntersection<Props & MiddlewareProps>, Middleware, ReturnValue>
	): MiddlewareResult<UnionToIntersection<Props & MiddlewareProps>, Middleware, ReturnValue>;
	function createMiddleware<
		ReturnValue,
		Middleware extends MiddlewareMap<any>,
		MiddlewareProps = Middleware[keyof Middleware]['properties']
	>(
		middlewares:
			| Middleware
			| MiddlewareCallback<UnionToIntersection<Props & MiddlewareProps>, Middleware, ReturnValue>,
		callback?: MiddlewareCallback<UnionToIntersection<Props & MiddlewareProps>, Middleware, ReturnValue>
	): any {
		if (callback) {
			return {
				middlewares,
				callback
			};
		}
		return {
			callback
		};
	}

	return createMiddleware;
}
