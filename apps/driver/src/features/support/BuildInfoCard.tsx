import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Banner, Card, SectionLabel } from '@/components';
import { env } from '@/lib/env';
import { useDriverContext } from '@/session/useDriverContext';

/**
 * "What am I actually running?" — the driver-side half of deploy truth (ship-pipeline plan D0.7).
 *
 * When a driver says "it still looks the same", this card is the screenshot to ask for. It answers
 * the three questions that used to take an hour of guessing: which JavaScript bundle is on this
 * phone, which commit the API is running, and whether the database matches that API.
 *
 * The API call is a plain `fetch` rather than `apiFetch` on purpose: `/api/version` is public, and
 * routing it through the authenticated helper would make this card wait on a token refresh — the
 * exact condition under which somebody most wants to read it.
 */
interface ApiVersion {
  commitShort: string | null;
  branch: string | null;
  env: string;
  schema: { expected: string | null; applied: string | null; state: string };
  ok: boolean;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between py-1">
      <Text className="pr-4 text-sm text-ink-secondary">{label}</Text>
      <Text className="flex-1 text-right text-sm font-sans-md text-ink-primary">{value}</Text>
    </View>
  );
}

export function BuildInfoCard() {
  const { data } = useDriverContext();
  const [api, setApi] = useState<ApiVersion | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    fetch(`${env.apiUrl}/api/version`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ApiVersion>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setApi)
      .catch((e: unknown) => setApiError(e instanceof Error ? e.message : 'unreachable'))
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // An update id means this JavaScript arrived over the air; its absence means it is the bundle that
  // shipped inside the installed binary. Distinguishing the two is the whole point of the row.
  const bundle = Updates.updateId
    ? `OTA ${Updates.updateId.slice(0, 8)}`
    : Updates.isEmbeddedLaunch === false
      ? 'downloaded'
      : 'built in';

  const schemaNote =
    api?.schema.state === 'behind'
      ? 'The server is newer than its database. Some screens may be missing data until migrations are applied.'
      : api?.schema.state === 'unknown'
        ? 'The server could not read its database version.'
        : null;

  return (
    <>
      <SectionLabel>About this build</SectionLabel>
      <Card>
        <Row label="App version" value={String(Constants.expoConfig?.version ?? 'unknown')} />
        <Row label="Runtime" value={String(Updates.runtimeVersion ?? 'unknown')} />
        <Row label="JavaScript" value={bundle} />
        <Row label="Update channel" value={String(Updates.channel ?? 'none')} />
        <Row label="Server" value={api ? `${api.commitShort ?? 'unknown'} · ${api.env}` : (apiError ?? 'checking…')} />
        <Row label="Database" value={api ? `${api.schema.applied ?? 'unknown'} (${api.schema.state})` : '—'} />
        <Text className="pt-2 text-xs text-ink-muted">
          Quote these lines when reporting a problem — they identify exactly which build you are on.
        </Text>
      </Card>
      {schemaNote ? <Banner tone="warning" message={schemaNote} /> : null}
      {data?.contractDegraded ? (
        <Banner
          tone="warning"
          message="This app is talking to an older server, so some features are hidden. It will come back on its own once the server updates."
        />
      ) : null}
    </>
  );
}
