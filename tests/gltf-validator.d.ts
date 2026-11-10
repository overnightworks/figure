declare module 'gltf-validator' {
	/** The severities of the validator's issues: 0 error, 1 warning, 2 information, 3 hint. */
	export interface ValidatorIssue {
		readonly code: string;
		readonly message: string;
		readonly severity: 0 | 1 | 2 | 3;
		readonly pointer?: string;
	}

	export interface ValidatorReport {
		readonly issues: {
			readonly numErrors: number;
			readonly numWarnings: number;
			readonly numInfos: number;
			readonly numHints: number;
			readonly messages: readonly ValidatorIssue[];
		};
		readonly info: { readonly resources: readonly { readonly image?: { readonly width: number; readonly height: number } }[] };
	}

	export function validateBytes(data: Uint8Array): Promise<ValidatorReport>;
}
