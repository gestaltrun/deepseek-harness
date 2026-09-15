/** Product bundles distributed by Desktop, in profile application order. */
export const DESKTOP_PRODUCT_BUNDLES = ['@gestaltrun/dsh-model-center', '@gestaltrun/dsh-im-bundle'] as const

/** Client boot entries each distributed product bundle contributes. */
export const DESKTOP_PRODUCT_CLIENT_ENTRIES: Readonly<Record<(typeof DESKTOP_PRODUCT_BUNDLES)[number], readonly string[]>> = {
  '@gestaltrun/dsh-model-center': ['@gestaltrun/dsh-model-center'],
  '@gestaltrun/dsh-im-bundle': ['@gestaltrun/dsh-api-im', '@gestaltrun/dsh-ui-im'],
}
