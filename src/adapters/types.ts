import type { PageKind, ParseResult, Portal } from '@/shared/types';

export interface PortalAdapter {
  portal: Portal;
  pageKind(url: string): PageKind;
  parseNextData(json: unknown, url: string): ParseResult;
  isInterceptedUrl(url: string): boolean;
  parseIntercepted(url: string, json: unknown): ParseResult;
  listingIdFromHref(href: string): number | null;
}
