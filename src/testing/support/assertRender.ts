import { DNode, WNode, VNode, DefaultWidgetBaseInterface, Constructor } from '../../core/interfaces';
import * as diff from 'diff';
import WeakMap from '../../shim/WeakMap';
import Set from '../../shim/Set';
import Map from '../../shim/Map';
import { from as arrayFrom } from '../../shim/array';
import { isVNode, isWNode } from '../../core/vdom';
import { Ignore } from '../assertionTemplate';
import { Instruction } from '../harness';

let widgetClassCounter = 0;
const widgetMap = new WeakMap<Constructor<DefaultWidgetBaseInterface>, number>();

const LINE_BREAK = '\n';
const TAB = '\t';

function formatTabs(depth = 0) {
	let tabs = '';
	for (let i = 0; i < depth; i++) {
		tabs = `${tabs}${TAB}`;
	}
	return tabs;
}

function replacer(key: string, value: any): any {
	if (typeof value === 'function') {
		return 'function';
	} else if (typeof value === 'undefined') {
		return 'undefined';
	} else if (value instanceof Set || value instanceof Map) {
		return arrayFrom(value);
	}
	return value;
}

export function formatDNodes(nodes: DNode | DNode[], depth: number = 0, initialIndentation = true): string {
	const isArrayFragment = Array.isArray(nodes) && depth === 0;
	const tabs = formatTabs(depth);
	let initial = isArrayFragment ? `[${LINE_BREAK}` : '';
	depth = isArrayFragment ? 1 : depth;
	nodes = Array.isArray(nodes) ? nodes : [nodes];

	let requiresCarriageReturn = false;
	let formattedNode = nodes.reduce((result: string, node) => {
		if (!node || node === true) {
			return result;
		}
		if (requiresCarriageReturn) {
			result = `${result}${LINE_BREAK}`;
		} else {
			requiresCarriageReturn = true;
		}
		if (initialIndentation) {
			result = `${result}${tabs}`;
		}

		if (typeof node === 'string') {
			return `${result}"${node}"`;
		}

		if (isVNode(node) && node.text) {
			return `${result}"${node.text}"`;
		}

		result = `${result}${formatNode(node, tabs, depth)}`;
		if (node.children && node.children.some((child) => !!child)) {
			result = `${result}, [${LINE_BREAK}${formatDNodes(node.children, depth + 1)}${LINE_BREAK}${tabs}]`;
		}
		return isNode(node) ? `${result})` : result;
	}, initial);

	return isArrayFragment ? (formattedNode = `${formattedNode}${LINE_BREAK}]`) : formattedNode;
}

function formatProperties(properties: any, tabs: string): string {
	properties = Object.keys(properties)
		.sort()
		.reduce((props: any, key) => {
			props[key] = properties[key];
			return props;
		}, {});
	properties = JSON.stringify(properties, replacer, `${tabs}${TAB}`).slice(0, -1);
	return `${properties}${tabs}}`;
}

function getWidgetName(widgetConstructor: any): string {
	let name: string;
	if (typeof widgetConstructor === 'string' || typeof widgetConstructor === 'symbol') {
		name = widgetConstructor.toString();
	} else {
		name = widgetConstructor.name;
		if (name === undefined) {
			let id = widgetMap.get(widgetConstructor);
			if (id === undefined) {
				id = ++widgetClassCounter;
				widgetMap.set(widgetConstructor, id);
			}
			name = `Widget-${id}`;
		}
	}
	return name;
}

function formatNode(node: WNode | VNode, tabs: any, depth: number): string {
	if (!isNode(node)) {
		if (typeof node === 'object') {
			let formattedChildren = Object.keys(node).reduce((formatted, key, index) => {
				if (index !== 0) {
					formatted = `${formatted}${LINE_BREAK}`;
				}
				return `${formatted}${tabs}${TAB}${key}: ${formatDNodes(node[key], depth + 1, false)}`;
			}, `{${LINE_BREAK}`);
			formattedChildren = formattedChildren ? `${formattedChildren}${LINE_BREAK}${tabs}}` : formattedChildren;
			return formattedChildren;
		} else {
			return '';
		}
	}

	const propertyKeyCount = Object.keys(node.properties).length;
	let properties = propertyKeyCount > 0 ? formatProperties(node.properties, tabs) : '{}';
	if (isWNode(node)) {
		return `w(${getWidgetName(node.widgetConstructor)}, ${properties}`;
	}
	return `v("${node.tag}", ${properties}`;
}

function isNode(node: any): node is VNode | WNode {
	return isVNode(node) || isWNode(node);
}

function isDNode(node: any): node is DNode {
	return isVNode(node) || isWNode(node) || typeof node === 'string';
}

function decorate(actual: any, expected: any, item?: Instruction): [DNode[], DNode[]] {
	actual = Array.isArray(actual) ? actual : [actual];
	expected = Array.isArray(expected) ? expected : [expected];
	let actualDecoratedNodes = [];
	let expectedDecoratedNodes = [];
	const length = actual.length > expected.length ? actual.length : expected.length;
	for (let i = 0; i < length; i++) {
		let actualNode = actual[i];
		let expectedNode = expected[i];

		if (typeof expectedNode === 'function') {
			return [actual, expected];
		}

		if (expectedNode && typeof expectedNode === 'object' && !isNode(expectedNode)) {
			const childObjectKeys = Object.keys(expectedNode);
			let decoratedExpectedNodes: any = {};
			let decoratedActualNodes: any = {};
			for (let i = 0; i < childObjectKeys.length; i++) {
				const key = childObjectKeys[i];
				if (isNode(actualNode[key])) {
					const result = decorate(actualNode[key], expectedNode[key], item);
					decoratedActualNodes[key] = result[0][0];
					decoratedExpectedNodes[key] = result[1][0];
				} else {
					decoratedActualNodes[key] = actualNode[key];
					decoratedExpectedNodes[key] = expectedNode[key];
				}
			}
			return [[decoratedActualNodes], [decoratedExpectedNodes]];
		}

		if (expectedNode && (expectedNode as any).widgetConstructor === Ignore) {
			expectedNode = actualNode || expectedNode;
		}

		if (item && expectedNode && (expectedNode as any).id === item.wrapped.id) {
			if (item.type === 'child') {
				if (typeof expectedNode.children[0] === 'object') {
					const keys = Object.keys(expectedNode.children[0]);
					for (let i = 0; i < keys.length; i++) {
						const key = keys[i];
						const newExpectedChildren = expectedNode.children[0][key]();
						expectedNode.children[0][key] = newExpectedChildren;
						if (
							Array.isArray(actualNode.children) &&
							actualNode.children[0] &&
							typeof actualNode.children[0][key] === 'function'
						) {
							const newActualChildren = actualNode.children[0][key](...item.params[key]);
							actualNode.children[0][key] = newActualChildren;
						}
					}
				} else if (typeof expectedNode.children[0] === 'function') {
					const newExpectedChildren = expectedNode.children[0]();
					expectedNode.children[0] = newExpectedChildren;
					if (Array.isArray(actualNode.children) && typeof actualNode.children[0] === 'function') {
						const newActualChildren = actualNode.children[0](...item.params);
						actualNode.children[0] = newActualChildren;
					}
				}
			} else {
				const result = expectedNode.properties[item.key]();
				if (isDNode(result) || (Array.isArray(result) && isNode(result[0]))) {
					expectedNode.properties[item.key] = result;
				}
				if (actualNode.properties[item.key]) {
					const actualResult = actualNode.properties[item.key](...item.params);
					if (isDNode(actualResult) || (Array.isArray(actualResult) && isNode(actualResult[0]))) {
						actualNode.properties[item.key] = actualResult;
					}
				}
			}
		}

		if (isNode(expectedNode)) {
			if (typeof expectedNode.properties === 'function') {
				const actualProperties = isNode(actualNode) ? actualNode.properties : {};
				expectedNode.properties = (expectedNode as any).properties(actualProperties);
			}
		}

		const childrenA = isNode(actualNode) ? actualNode.children : [];
		const childrenB = isNode(expectedNode) ? expectedNode.children : [];

		const [actualChildren, expectedChildren] = decorate(childrenA, childrenB, item);
		if (isNode(actualNode)) {
			actualNode.children = actualChildren;
		}
		if (isNode(expectedNode)) {
			expectedNode.children = expectedChildren;
		}
		actualDecoratedNodes.push(actualNode);
		expectedDecoratedNodes.push(expectedNode);
	}
	return [actualDecoratedNodes, expectedDecoratedNodes];
}

export function assertRender(actual: DNode | DNode[], expected: DNode | DNode[], queue: Instruction[] = []): void {
	let decoratedActual = Array.isArray(actual) ? actual : [actual];
	let decoratedExpected = Array.isArray(expected) ? expected : [expected];
	if (queue.length) {
		for (let i = 0; i < queue.length; i++) {
			[decoratedActual, decoratedExpected] = decorate(decoratedActual, decoratedExpected, queue[i]);
		}
	} else {
		[decoratedActual, decoratedExpected] = decorate(actual, expected);
	}

	const parsedActual = formatDNodes(Array.isArray(actual) ? decoratedActual : decoratedActual[0]);
	const parsedExpected = formatDNodes(Array.isArray(expected) ? decoratedExpected : decoratedExpected[0]);
	const diffResult = diff.diffLines(parsedActual, parsedExpected);
	let diffFound = false;
	const parsedDiff = diffResult.reduce((result: string, part, index) => {
		if (part.added) {
			diffFound = true;
			result = `${result}(E)${part.value.replace(/\n\t/g, '\n(E)\t')}`;
		} else if (part.removed) {
			diffFound = true;
			result = `${result}(A)${part.value.replace(/\n\t/g, '\n(A)\t')}`;
		} else {
			result = `${result}${part.value}`;
		}
		return result;
	}, '\n');

	if (diffFound) {
		throw new Error(parsedDiff);
	}
}

export default assertRender;
