import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { clearbitLogoUrl, logoUrlForDomain, searchBrands } from "@/lib/gift-card-brands";

const LOGO_LOOKUP_CACHE_KEY = "sentryfi_merchant_logo_lookup_v1";
type LogoLookupResult = { domain: string; logo: string | null };
type LogoLookupCache = Record<string, LogoLookupResult | null>;
const pendingLookups = new Map<string, Promise<LogoLookupResult | null>>();

const cacheKeyFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function readLookupCache(): LogoLookupCache {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOGO_LOOKUP_CACHE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as LogoLookupCache : {};
  } catch { return {}; }
}

const findMerchantMatch = (results: Awaited<ReturnType<typeof searchBrands>>, name: string) => {
  const merchant = cacheKeyFor(name);
  return results.find(result => {
    const brand = cacheKeyFor(result.name);
    return brand.length >= 3 && (brand === merchant || merchant.startsWith(brand) || brand.startsWith(merchant));
  });
};

function lookupBrand(name: string, category: string | null, key: string): Promise<LogoLookupResult | null> {
  const cached = readLookupCache();
  if (cached[key]?.domain) return Promise.resolve(cached[key]);
  const pending = pendingLookups.get(key);
  if (pending) return pending;

  const task = searchBrands(name).then(async initialResults => {
    let results = initialResults;
    let match = findMerchantMatch(results, name);
    if (!match && category) {
      results = await searchBrands(`${name} ${category}`);
      match = findMerchantMatch(results, name);
    }
    const domain = match?.domain && /^[a-z0-9.-]+$/i.test(match.domain) ? match.domain : null;
    const result = domain ? { domain, logo: match?.logo?.startsWith("https://") ? match.logo : null } : null;
    const next = readLookupCache();
    if (result) next[key] = result;
    try { localStorage.setItem(LOGO_LOOKUP_CACHE_KEY, JSON.stringify(next)); } catch { /* Cache is best-effort; logos still render this session. */ }
    return result;
  }).catch(() => {
    // Don't cache network failures or empty results permanently; a later visit can retry.
    return null;
  }).finally(() => pendingLookups.delete(key));
  pendingLookups.set(key, task);
  return task;
}

const KNOWN_MERCHANT_DOMAINS: Record<string, string> = {
  "taco bell": "tacobell.com", "starbucks": "starbucks.com", "mcdonalds": "mcdonalds.com",
  "mcdonald s": "mcdonalds.com", "amazon": "amazon.com", "walmart": "walmart.com",
  "target": "target.com", "costco": "costco.com", "doordash": "doordash.com",
  "uber eats": "ubereats.com", "uber": "uber.com", "netflix": "netflix.com",
  "apple": "apple.com", "home depot": "homedepot.com", "walgreens": "walgreens.com", "cvs": "cvs.com",
};

function websiteDomain(website?: string | null): string | null {
  const host = website?.trim().replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  return /^[a-z0-9.-]+$/i.test(host) ? host : null;
}

export function MerchantLogo({
  name, category, website, logoUrl, size = 32, className,
}: {
  name: string;
  category?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const cacheKey = cacheKeyFor(`${name} ${category ?? ""}`);
  const [searchedBrand, setSearchedBrand] = useState<LogoLookupResult | null>(() => readLookupCache()[cacheKey] ?? null);
  const [lookupDone, setLookupDone] = useState(() => !!readLookupCache()[cacheKey]?.domain);
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const knownDomain = Object.entries(KNOWN_MERCHANT_DOMAINS)
    .find(([brand]) => normalizedName === brand || normalizedName.startsWith(`${brand} `))?.[1];
  const domain = websiteDomain(website) ?? knownDomain;
  const sources = [...new Set([
    logoUrl,
    searchedBrand?.logo,
    searchedBrand?.domain ? logoUrlForDomain(searchedBrand.domain, Math.max(size * 4, 256)) : null,
    domain ? logoUrlForDomain(domain, Math.max(size * 4, 256)) : null,
    searchedBrand?.domain ? clearbitLogoUrl(searchedBrand.domain, Math.max(size * 4, 256)) : null,
    domain ? clearbitLogoUrl(domain, Math.max(size * 4, 256)) : null,
    searchedBrand?.domain ? `https://icons.duckduckgo.com/ip3/${searchedBrand.domain}.ico` : null,
    domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null,
  ])].filter((url): url is string => !!url?.startsWith("https://") && !failedSources.includes(url));
  const source = sources[0] ?? null;
  const showLogo = !!source && loadedSource === source;
  const showInitial = !source && (lookupDone || failedSources.length > 0);

  useEffect(() => {
    if (lookupDone) return;
    let active = true;
    void lookupBrand(name, category ?? null, cacheKey).then(foundBrand => {
      if (!active) return;
      setSearchedBrand(foundBrand);
      setLookupDone(true);
    });
    return () => { active = false; };
  }, [cacheKey, category, lookupDone, name]);

  return (
    <div
      role="img"
      aria-label={`${name} logo`}
      className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/45", className)}
      style={{ width: size, height: size }}
    >
      {!showLogo && (showInitial ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center rounded-lg bg-muted font-semibold text-muted-foreground"
          style={{ fontSize: Math.max(10, size * 0.4) }}
        >
          {(name.trim()[0] ?? "?").toUpperCase()}
        </span>
      ) : (
        <span aria-hidden="true" className="absolute inset-0 animate-pulse rounded-lg bg-muted/70" />
      ))}
      {source ? (
        <img
          src={source}
          alt=""
          decoding="async"
          className={cn("relative max-h-[90%] max-w-[90%] object-contain transition-opacity duration-150", loadedSource === source ? "opacity-100" : "opacity-0")}
          onLoad={() => setLoadedSource(source)}
          onError={() => { setLoadedSource(null); setFailedSources(failed => failed.includes(source) ? failed : [...failed, source]); }}
        />
      ) : null}
    </div>
  );
}
