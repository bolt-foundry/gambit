export * from '../exports';
import { PostHogBackendClient } from '../client';
import { PostHogContext } from '../extensions/context/context';
export declare class PostHog extends PostHogBackendClient {
    getLibraryId(): string;
    protected initializeContext(): PostHogContext;
}
//# sourceMappingURL=index.node.d.ts.map