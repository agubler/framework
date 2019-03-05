import { WidgetBase } from '../widget-core/WidgetBase';
import { RenderResult, SupportedClassName } from '../widget-core/interfaces';
import { Params } from './interfaces';
import { Router } from './Router';
import { alwaysRender } from '../widget-core/decorators/alwaysRender';
import diffProperty from '../widget-core/decorators/diffProperty';
import { Handle } from '../core/Destroyable';

export interface VirtualLinkProperties {
	renderer: (p: { gotoRoute: Function; active: boolean; exact: boolean }) => RenderResult;
	to: string;
	routerKey?: string;
	isOutlet?: boolean;
	params?: Params;
	activeClasses?: SupportedClassName[];
}

function paramsEqual(linkParams: any = {}, contextParams: any = {}) {
	return Object.keys(linkParams).every((key) => linkParams[key] === contextParams[key]);
}

@alwaysRender()
export class VirtualLink extends WidgetBase<VirtualLinkProperties, never> {
	private _outletHandle: Handle | undefined;

	@diffProperty('to')
	protected _onOutletPropertyChange(previous: VirtualLinkProperties, current: VirtualLinkProperties) {
		const { to, routerKey = 'router' } = current;
		const item = this.registry.getInjector<Router>(routerKey);
		if (this._outletHandle) {
			this._outletHandle.destroy();
			this._outletHandle = undefined;
		}
		if (item) {
			const router = item.injector();
			this._outletHandle = router.on('outlet', ({ outlet }) => {
				if (outlet.id === to) {
					this.invalidate();
				}
			});
		}
	}

	protected render(): RenderResult {
		const { renderer, routerKey = 'router', to, isOutlet = true, params = {} } = this.properties;
		const item = this.registry.getInjector<Router>(routerKey);

		if (item) {
			let href = to;
			const router = item.injector();
			if (isOutlet) {
				href = router.link(to, params) || to;
			}
			const context = router.getOutlet(to);
			const active = !!context && paramsEqual(params, context.params);
			const exact = active && !!context && context.isExact();
			return renderer({
				gotoRoute: () => {
					router.setPath(href);
				},
				active,
				exact
			});
		}
		return null;
	}
}

export default VirtualLink;
