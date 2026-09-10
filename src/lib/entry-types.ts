import type {EntryContext} from './entry-context'
export type EntryResult={purchase_id:string|null;wine_ids:string[];winery_id:string|null;visit_id:string|null;trip_id:string|null}
export type EntryCompletion={result:EntryResult;context:EntryContext;retryPhoto?:()=>Promise<void>;refreshFailed:boolean}
