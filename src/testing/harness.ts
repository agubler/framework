import assertRender from './support/assertRender';
import { decorateNodes, select } from './support/selector';
import {
	WNode,
	DNode,
	Constructor,
	VNode,
	Callback,
	RenderResult,
	MiddlewareResultFactory,
	WNodeFactory,
	VNodeProperties
} from '../core/interfaces';
import { WidgetBase } from '../core/WidgetBase';
import { isWidgetFunction } from '../core/Registry';
import { invalidator, diffProperty, destroy, create, propertiesDiff, w, v } from '../core/vdom';
import { uuid } from '../core/util';
import { findIndex } from '../shim/array';

export interface CustomComparator {
	selector: string;
	property: string;
	comparator: (value: any) => boolean;
}

export interface FunctionalSelector {
	(node: VNode | WNode): undefined | Function;
}

export interface ExpectedRender {
	(): DNode | DNode[];
}

export interface Expect {
	(expectedRenderFunc: ExpectedRender): void;
	(expectedRenderFunc: ExpectedRender, actualRenderFunc?: ExpectedRender): void;
}

export interface ExpectPartial {
	(selector: string, expectedRenderFunc: ExpectedRender): void;
	(selector: string, expectedRenderFunc: ExpectedRender, actualRenderFunc?: ExpectedRender): void;
}

export interface Trigger {
	(selector: string, functionSelector: FunctionalSelector, ...args: any[]): any;
	(selector: string, functionSelector: string, ...args: any[]): any;
}

export interface GetRender {
	(index?: number): DNode | DNode[];
}

export type InstructionType = 'child' | 'property';

export type Wrapped<T> = T & { id: string };

export interface ChildInstruction {
	type: 'child';
	wrapped: Wrapped<any>;
	params: any;
}

export interface PropertyInstruction {
	type: 'property';
	key: string;
	wrapped: Wrapped<any>;
	params: any;
}

export type Instruction = ChildInstruction | PropertyInstruction;

export interface Child {
	<T extends WNodeFactory<{ properties: any; children: any }>>(
		wrapped: Wrapped<T>,
		params: T['children'] extends { [index: string]: (...args: any[]) => RenderResult }
			? { [P in keyof T['children']]: Parameters<T['children'][P]> }
			: T['children'] extends (...args: any[]) => RenderResult ? Parameters<T['children']> : never
	): void;
}

export type KnownKeys<T> = { [K in keyof T]: string extends K ? never : number extends K ? never : K } extends {
	[_ in keyof T]: infer U
}
	? U
	: never;

type FunctionPropertyNames<T> = { [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never }[keyof T];

type RequiredVNodeProperties = Required<Pick<VNodeProperties, KnownKeys<VNodeProperties>>>;

export interface Property {
	<T extends WidgetBase<any, any>, K extends FunctionPropertyNames<T['properties']>>(
		wrapped: Constructor<T>,
		key: K,
		params: Parameters<T['properties'][K]>
	): void;
	<
		T extends WNodeFactory<{ properties: any; children: any }>,
		K extends FunctionPropertyNames<
			T['properties'] extends RequiredVNodeProperties ? RequiredVNodeProperties : T['properties']
		>
	>(
		wrapped: T,
		key: K,
		params: Parameters<T['properties'][K]>
	): void;
	// <T extends string, K extends FunctionPropertyNames<RequiredVNodeProperties>>(
	// 	wrapped: T,
	// 	key: K,
	// 	params?: any
	// ): void;
}

export interface HarnessAPI {
	expect: Expect;
	expectPartial: ExpectPartial;
	trigger: Trigger;
	getRender: GetRender;
	child: Child;
	property: Property;
}

let middlewareId = 0;

interface HarnessOptions {
	customComparator?: CustomComparator[];
	middleware?: [MiddlewareResultFactory<any, any, any, any>, MiddlewareResultFactory<any, any, any, any>][];
}

const factory = create();

export function wrap<T>(
	node: T
): T extends string
	? Wrapped<WNodeFactory<{ properties: VNodeProperties; children: DNode | (DNode | DNode[])[] }>>
	: Wrapped<T> {
	const id = uuid();
	const nodeFactory: any = (properties: any, children: any[]) => {
		const dNode: any =
			typeof node === 'string' ? v(node, properties, children) : w(node as any, properties, children);
		dNode.id = id;
		return dNode;
	};
	nodeFactory.id = id;
	nodeFactory.isFactory = true;
	return nodeFactory;
}

export function harness(renderFunc: () => WNode, options?: HarnessOptions): HarnessAPI;
export function harness(renderFunc: () => WNode, customComparator?: CustomComparator[]): HarnessAPI;
export function harness(renderFunc: () => WNode, options: HarnessOptions | CustomComparator[] = []): HarnessAPI {
	let invalidated = true;
	let wNode = renderFunc();
	const renderStack: (DNode | DNode[])[] = [];
	let widget: WidgetBase | Callback<any, any, any, RenderResult>;
	let middleware: any = {};
	let properties: any = {};
	let children: any = [];
	let customDiffs: any[] = [];
	let customDiffNames: string[] = [];
	let instructionQueue: Instruction[] = [];
	let customComparator: CustomComparator[] = [];
	let mockMiddleware: [
		MiddlewareResultFactory<any, any, any, any>,
		MiddlewareResultFactory<any, any, any, any>
	][] = [];
	if (Array.isArray(options)) {
		customComparator = options;
	} else {
		if (options.middleware) {
			mockMiddleware = options.middleware;
		}
		if (options.customComparator) {
			customComparator = options.customComparator;
		}
	}

	if (isWidgetFunction(wNode.widgetConstructor)) {
		widget = wNode.widgetConstructor;

		const resolveMiddleware = (middlewares: any, mocks: any[]) => {
			const keys = Object.keys(middlewares);
			const results: any = {};
			const uniqueId = `${middlewareId++}`;
			const mockMiddlewareMap = new Map(mocks);

			for (let i = 0; i < keys.length; i++) {
				let isMock = false;
				let middleware = middlewares[keys[i]]();
				if (mockMiddlewareMap.has(middlewares[keys[i]])) {
					middleware = mockMiddlewareMap.get(middlewares[keys[i]]);
					isMock = true;
				}
				const payload: any = {
					id: uniqueId,
					properties: () => {
						return { ...properties };
					},
					children: () => {
						return children;
					}
				};
				if (middleware.middlewares) {
					const resolvedMiddleware = resolveMiddleware(middleware.middlewares, mocks);
					payload.middleware = resolvedMiddleware;
					results[keys[i]] = middleware.callback(payload);
				} else {
					if (isMock) {
						let result = middleware();
						const resolvedMiddleware = resolveMiddleware(result.middlewares, mocks);
						payload.middleware = resolvedMiddleware;
						results[keys[i]] = result.callback(payload);
					} else {
						results[keys[i]] = middleware.callback(payload);
					}
				}
			}
			return results;
		};
		mockMiddleware.push([
			invalidator,
			factory(() => () => {
				invalidated = true;
			})
		]);
		mockMiddleware.push([destroy, factory(() => () => {})]);
		mockMiddleware.push([
			diffProperty,
			factory(() => (propName: string, func: any) => {
				if (customDiffNames.indexOf(propName) === -1) {
					customDiffNames.push(propName);
					customDiffs.push(func);
				}
			})
		]);
		middleware = resolveMiddleware((wNode.widgetConstructor as any).middlewares, mockMiddleware);
	} else {
		const widgetConstructor = wNode.widgetConstructor as Constructor<WidgetBase>;
		if (typeof widgetConstructor === 'function') {
			widget = new class extends widgetConstructor {
				invalidate() {
					invalidated = true;
					super.invalidate();
				}
			}();
			_tryRender();
		} else {
			throw new Error('Harness does not support registry items');
		}
	}

	function _getRender(count?: number): DNode | DNode[] {
		return count ? renderStack[count] : renderStack[renderStack.length - 1];
	}

	function _runCompares(nodes: DNode | DNode[], isExpected: boolean = false) {
		customComparator.forEach(({ selector, property, comparator }) => {
			const items = select(selector, nodes);
			items.forEach((item: any) => {
				const comparatorName = `comparator(selector=${selector}, ${property})`;
				if (item && item.properties && item.properties[property] !== undefined) {
					const comparatorResult = comparator(item.properties[property])
						? comparatorName
						: `${comparatorName} FAILED`;
					item.properties[property] = isExpected ? comparatorName : comparatorResult;
				}
			});
		});
	}

	function _tryRender() {
		let render: RenderResult;
		const wNode = renderFunc();
		if (isWidgetFunction(widget)) {
			customDiffs.forEach((diff) => diff(properties, wNode.properties));
			propertiesDiff(
				properties,
				wNode.properties,
				() => {
					invalidated = true;
				},
				[...customDiffNames]
			);
			if (children.length || wNode.children.length) {
				invalidated = true;
			}
			properties = { ...wNode.properties };
			children = wNode.children;
			if (invalidated) {
				render = widget({ id: 'test', middleware, properties: () => properties, children: () => children });
			}
		} else {
			widget.__setProperties__(wNode.properties);
			widget.__setChildren__(wNode.children);
			if (invalidated) {
				render = widget.__render__();
			}
		}
		if (invalidated) {
			const { hasDeferredProperties, nodes } = decorateNodes(render);
			_runCompares(nodes);
			renderStack.push(nodes);
			if (hasDeferredProperties) {
				const { nodes: afterDeferredPropertiesNodes } = decorateNodes(render);
				_runCompares(afterDeferredPropertiesNodes);
				renderStack.push(afterDeferredPropertiesNodes);
			}
			invalidated = false;
		}
	}

	function _expect(expectedRenderFunc: ExpectedRender, actualRenderFunc?: ExpectedRender, selector?: string) {
		let renderResult: DNode | DNode[];
		if (actualRenderFunc === undefined) {
			_tryRender();
			renderResult = _getRender();
		} else {
			renderResult = actualRenderFunc();
			_runCompares(renderResult);
		}

		const { nodes: expectedRenderResult } = decorateNodes(expectedRenderFunc());
		_runCompares(expectedRenderResult, true);
		const queue = [...instructionQueue];
		instructionQueue = [];
		if (selector) {
			const [firstItem] = select(selector, renderResult);
			assertRender(firstItem, expectedRenderResult, queue);
		} else {
			assertRender(renderResult, expectedRenderResult, queue);
		}
	}

	return {
		child(wrapped: any, params: any) {
			const index = findIndex(
				instructionQueue,
				(instruction) => instruction.type === 'child' && instruction.wrapped === wrapped
			);
			if (index === -1) {
				instructionQueue.push({ wrapped, params, type: 'child' });
			} else {
				instructionQueue[index] = { wrapped, params, type: 'child' };
			}
		},
		property(wrapped: any, key: any, params: any) {
			const index = findIndex(
				instructionQueue,
				(instruction) =>
					instruction.type === 'property' && instruction.wrapped === wrapped && instruction.key === key
			);
			if (index === -1) {
				instructionQueue.push({ wrapped, params, type: 'property', key });
			} else {
				instructionQueue[index] = { wrapped, params, type: 'property', key };
			}
		},
		expect(expectedRenderFunc: ExpectedRender, actualRenderFunc?: ExpectedRender) {
			return _expect(expectedRenderFunc, actualRenderFunc);
		},
		expectPartial(selector: string, expectedRenderFunc: ExpectedRender, actualRenderFunc?: ExpectedRender) {
			return _expect(expectedRenderFunc, actualRenderFunc, selector);
		},
		trigger(selector: string, functionSelector: string | FunctionalSelector, ...args: any[]): any {
			_tryRender();
			const [firstItem] = select(selector, _getRender());

			if (!firstItem) {
				throw new Error(`Cannot find node with selector ${selector}`);
			}

			let triggerFunction: Function | undefined;
			if (typeof functionSelector === 'string') {
				triggerFunction = (firstItem.properties as any)[functionSelector];
			} else {
				triggerFunction = functionSelector(firstItem);
			}
			if (triggerFunction) {
				return triggerFunction.apply(widget, args);
			}
		},
		getRender(index?: number): DNode | DNode[] {
			return _getRender(index);
		}
	};
}

export default harness;
