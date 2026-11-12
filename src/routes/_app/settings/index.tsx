import { createFileRoute } from "@tanstack/react-router";
import { ApiKeySettings } from "@/client/features/settings/ApiKeySettings";
import { SectionHeader } from "@/client/components/PageHeader";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
import { PrivacySettings } from "@/client/features/settings/PrivacySettings";
import {
  isHostedClientAuthMode,
  isSessionClientAuthMode,
} from "@/lib/auth-mode";
import { version } from "../../../../package.json";

export const Route = createFileRoute("/_app/settings/")({
  component: PersonalSettings,
});

function PersonalSettings() {
  const isHosted = isHostedClientAuthMode();
  // API keys exist wherever real sessions do (hosted + self-hosted oauth —
  // they are the MCP credential, spec 016); privacy choices are hosted-only.
  const isSessionAuth = isSessionClientAuthMode();
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <SectionHeader title="Appearance" />
        <div className="flex items-center justify-between gap-6">
          <span className="text-sm">Theme</span>
          <ThemePreferenceRadio />
        </div>
      </section>

      {isSessionAuth ? <ApiKeySettings /> : null}

      {isHosted ? <PrivacySettings /> : null}

      {!isSessionAuth ? (
        <section className="space-y-3">
          <SectionHeader title="About" />
          <div className="flex items-center justify-between gap-6">
            <span className="text-sm">Version</span>
            <span className="font-mono text-sm text-muted-foreground">
              v{version}
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
