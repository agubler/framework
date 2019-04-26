// import { widget, tsx, v } from './tsx';
// import dimensions from './middlewares/dimensions';
// import { w } from './d';

// const createWidget = widget();
// const createWidget2 = widget({ dimensions });

// export const MyWidget = createWidget<{ foo: string }>(({ properties }) => {
// 	// middleware.dimensions.get('root');
// 	return properties.foo;
// });

// export const MyWidget2 = createWidget2<{ foo: string }>(({ properties, middleware }) => {
// 	// middleware.dimensions.get('root');
// 	return properties.foo;
// });

// <MyWidget foo="">
// 	<div />
// </MyWidget>;

// MyWidget({ foo: '' }, [v('div')]);

// w(MyWidget, { fo: '' });

// // function resolveMiddleware(middlewares: any): any {
// // 	const keys = Object.keys(middlewares);
// // 	const results: any = {};
// // 	for (let i = 0; i < keys.length; i++) {
// // 		const middleware = middlewares[keys[i]];
// // 		if (middleware.middlewares) {
// // 			const blah = resolveMiddleware(middleware.middlewares);
// // 			results[keys[i]] = middleware.callback({ middlewares: blah });
// // 		} else {
// // 			results[keys[i]] = middleware.callback({});
// // 		}
// // 	}
// // 	return results;
// // }

// // const intersection = {} as {
// // 	api: { get(): boolean };
// // 	properties: { test: string };
// // };

// // const cache = {} as {
// // 	api: { get(id: string): any; set(id: string): void };
// // };

// // // const dom = {}

// // // const dimensions = {} as {
// // // 	api: {
// // // 		dimensions(key: string)
// // // 	}
// // // 	const domNodes = getNodesById(id, () => {

// // // 	});
// // // }

// // function getNodeById(id: string, key: string, callback: () => void): HTMLElement | null {
// // 	return {} as any;
// // }

// // const createFactory = createMiddleware();
// // const dom = createFactory({ cache }, ({ id, invalidator }) => {
// // 	return {
// // 		get(key: any): HTMLElement | null {
// // 			const blah = getNodeById(id, key, () => {
// // 				invalidator();
// // 			});
// // 			return blah;
// // 		}
// // 	}
// // })

// // const defaultDimensions = {
// // 	client: {
// // 		height: 0,
// // 		left: 0,
// // 		top: 0,
// // 		width: 0
// // 	},
// // 	offset: {
// // 		height: 0,
// // 		left: 0,
// // 		top: 0,
// // 		width: 0
// // 	},
// // 	position: {
// // 		bottom: 0,
// // 		left: 0,
// // 		right: 0,
// // 		top: 0
// // 	},
// // 	scroll: {
// // 		height: 0,
// // 		left: 0,
// // 		top: 0,
// // 		width: 0
// // 	},
// // 	size: {
// // 		width: 0,
// // 		height: 0
// // 	}
// // };

// // const dimensions = createFactory({ dom }, ({ id, middleware }) => {
// // 	return {
// // 		get(key: any): any | null {
// // 			const node = middleware.dom.get(key);
// // 			if (!node) {
// // 				return defaultDimensions;
// // 			}

// // 			const boundingDimensions = node.getBoundingClientRect();

// // 			return {
// // 				client: {
// // 					height: node.clientHeight,
// // 					left: node.clientLeft,
// // 					top: node.clientTop,
// // 					width: node.clientWidth
// // 				},
// // 				offset: {
// // 					height: node.offsetHeight,
// // 					left: node.offsetLeft,
// // 					top: node.offsetTop,
// // 					width: node.offsetWidth
// // 				},
// // 				position: {
// // 					bottom: boundingDimensions.bottom,
// // 					left: boundingDimensions.left,
// // 					right: boundingDimensions.right,
// // 					top: boundingDimensions.top
// // 				},
// // 				scroll: {
// // 					height: node.scrollHeight,
// // 					left: node.scrollLeft,
// // 					top: node.scrollTop,
// // 					width: node.scrollWidth
// // 				},
// // 				size: {
// // 					width: boundingDimensions.width,
// // 					height: boundingDimensions.height
// // 				}
// // 			};
// // 		}
// // 	}
// // })

// // const a = createMiddleware<{ barry: number }>();
// // const newMiddleware = a({ cache }, ({ id, middleware, properties, invalidator }) => {
// // 	properties.barry

// // 	// theme // (properties !== properties)
// // 	return {
// // 		blah() {
// // 			return true;
// // 		}
// // 	}
// // });

// // function Foo() {
// // 	return v('div');
// // }

// // const func = creator({ dimensions });

// // const Widget = func<{ foo: string }>(({ properties, middleware }) => {
// // 	const dimensions = middleware.dimensions.get('root');
// // 	return null;
// // });

// // <Widget foo="" />;

// // Widget({foo: ''});

// // interface ReturnWithMiddleware<Props, MiddlewareProps, Middleware, FinalProps = Props & MiddlewareProps> {
// // 	<ReturnValue>(
// // 		middleware: (
// // 			{ properties, middleware }: { properties: FinalProps; middleware: MiddlewareApiMap<Middleware> }
// // 		) => ReturnValue
// // 	): { api: ReturnValue; properties: FinalProps; (properties: FinalProps): ReturnValue };
// // }

// // interface CreateReturn<Props> {
// // 	<ReturnValue>(middleware: ({ properties }: { properties: Props }) => ReturnValue): {
// // 		api: ReturnValue;
// // 		properties: Props;
// // 		(properties: Props): ReturnValue;
// // 	};
// // 	middleware<Middleware extends MiddlewareMap<any>, MiddlewareProps = Middleware[keyof Middleware]['properties']>(
// // 		use: Middleware
// // 	): ReturnWithMiddleware<Props, MiddlewareProps, Middleware>;
// // }

// // function create<Props>(): CreateReturn<Props> {
// // 	return function() {} as any;
// // }

// // const middleware = create<{ theme?: string }>();
// // const themed = middleware(({ properties }) => {
// // 	return {
// // 		get(key: any) {
// // 			return { theme: 'foo' };
// // 		}
// // 	};
// // });

// // const middleware2 = create<{ intersection?: boolean }>().middleware({ themed });
// // const intersectidon = middleware2(({ properties, middleware }) => {
// // 	return {
// // 		get(key: any) {
// // 			return middleware.themed.get('foo');
// // 		}
// // 	};
// // });

// // // const renderable = create<{ hello: string }>();
// // // const Foo = renderable(({ properties }) => {
// // //     const { hello } = properties;
// // //     return <div>{ hello }</div>
// // // })

// // const renderable2 = create<{ bar: boolean }>().middleware({ intersectidon });
// // const Bar = renderable2(({ properties, middleware }) => {
// // 	properties;
// // 	const test = middleware.intersectidon.get('root');
// // 	return <div>{test.theme}</div>;
// // });

// // // Foo({ hello: 'cool' });
// // // Bar({ bar: true });

// // // const test = <Foo hello='blah' />
// // // const test2 = <Bar bar={true} />
