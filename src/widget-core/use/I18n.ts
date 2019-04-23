/* tslint:disable:interface-name */
import Map from '../../shim/Map';
import i18n, { Bundle, formatMessage, getCachedMessages, Messages } from '../../i18n/i18n';
import { Destroyable } from '../../core/Destroyable';
import { UseOptions, UseBase } from '../interfaces';

export const INJECTOR_KEY = '__i18n_injector';

export interface LocaleData {
	locale?: string;
	rtl?: boolean;
}

export type LocalizedMessages<T extends Messages> = {
	readonly isPlaceholder: boolean;
	format(key: string, options?: any): string;
	readonly messages: T;
};

export class I18n extends Destroyable implements UseBase {
	private _invalidator: any;
	private _injector: any;
	private _injectedLocaleData: any;
	private _properties: any;

	constructor(options: UseOptions) {
		super();
		this._invalidator = options.invalidate;
		this._injector = options.registry.getInjector('__i18n_injector');
		this._properties = options.properties;
		if (this._injector) {
			const { invalidator, injector } = this._injector;
			this._injectedLocaleData = injector();
			this.own(
				invalidator.on('invalidate', () => {
					this._injectedLocaleData = injector();
					this._invalidator();
				})
			);
		}
	}

	private get properties(): any {
		const injectedValues = this._injectedLocaleData;
		const { locale = injectedValues.locale, rtl = injectedValues.rtl } = this._properties;
		return { locale, rtl };
	}

	public __setProperties__(properties: any) {
		this._properties = properties;
	}

	public get(bundle: any, useDefaults = false): any {
		bundle = this._resolveBundle(bundle);
		const messages = this._getLocaleMessages(bundle);
		const isPlaceholder = !messages;
		const { locale } = this.properties;
		const format =
			isPlaceholder && !useDefaults
				? (key: string, options?: any) => ''
				: (key: string, options?: any) => formatMessage(bundle, key, options, locale);

		return Object.create({
			format,
			isPlaceholder,
			messages: messages || (useDefaults ? bundle.messages : this._getBlankMessages(bundle))
		});
	}

	private _getBlankMessages(bundle: Bundle<Messages>): Messages {
		const blank = {} as Messages;
		return Object.keys(bundle.messages).reduce((blank, key) => {
			blank[key] = '';
			return blank;
		}, blank);
	}

	private _getLocaleMessages(bundle: Bundle<Messages>): Messages | void {
		const { properties } = this;
		const locale = properties.locale || i18n.locale;
		const localeMessages = getCachedMessages(bundle, locale);

		if (localeMessages) {
			return localeMessages;
		}

		i18n(bundle, locale).then(() => {
			this._invalidator();
		});
	}

	private _resolveBundle(bundle: Bundle<Messages>): Bundle<Messages> {
		let { i18nBundle } = this.properties;
		if (i18nBundle) {
			if (i18nBundle instanceof Map) {
				i18nBundle = i18nBundle.get(bundle);

				if (!i18nBundle) {
					return bundle;
				}
			}

			return i18nBundle;
		}
		return bundle;
	}
}

export default I18n;
