import packageMetadata from '../package.json'

/** The root package version is the single source of truth for the deployed app. */
export const APP_VERSION = packageMetadata.version
