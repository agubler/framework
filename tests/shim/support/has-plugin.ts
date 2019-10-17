intern.registerPlugin('has', () => {
	const DojoHasEnvironment = {
		staticFeatures: {
			test: true
		}
	};
	if (typeof global !== 'undefined') {
		(global as any).DojoHasEnvironment = DojoHasEnvironment;
		(global as any).__DOJO_SCOPE = 'dojo_test_scope';
	}

	if (typeof self !== 'undefined') {
		(self as any).DojoHasEnvironment = DojoHasEnvironment;
		(self as any).__DOJO_SCOPE = 'dojo_test_scope';
	}

	if (typeof window !== 'undefined') {
		(window as any).DojoHasEnvironment = DojoHasEnvironment;
		(window as any).__DOJO_SCOPE = 'dojo_test_scope';
	}
});
