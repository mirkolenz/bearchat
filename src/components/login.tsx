import { useActionState, useState } from "react";

import { CenteredPage } from "@/components/centered-page";
import { DataSection } from "@/components/data-section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { config } from "@/lib/config";
import { type Session, rememberedBaseURL, signIn } from "@/lib/connection";
import { errorMessage } from "@/lib/utils";

interface LoginProps {
  error?: string;
  onSignIn: (session: Session) => void;
}

export function Login({ error: initialError, onSignIn }: LoginProps) {
  const [baseURL, setBaseURL] = useState(rememberedBaseURL);
  const [token, setToken] = useState("");
  const [error, submit, pending] = useActionState(async () => {
    try {
      onSignIn(await signIn(baseURL, token.trim()));
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  }, initialError);

  return (
    <CenteredPage title={config.title}>
      <form action={submit}>
        <FieldGroup>
          {config.baseURL === undefined && (
            <Field>
              <FieldLabel htmlFor="base-url">Server URL</FieldLabel>
              <Input
                id="base-url"
                type="url"
                autoComplete="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder="https://openrouter.ai/api/v1"
                value={baseURL}
                onChange={(event) => setBaseURL(event.target.value)}
              />
              <FieldDescription>
                An OpenAI-compatible endpoint, including the /v1 suffix.
              </FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="token">Token</FieldLabel>
            <Input
              id="token"
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              required={config.baseURL !== undefined}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <FieldDescription>
              {config.auth === "cookie"
                ? "Stored in a secure cookie that scripts cannot read."
                : "Kept in this tab only and cleared when it closes."}
            </FieldDescription>
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="wrap-anywhere">{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            Sign in
          </Button>
          {/* data stays in the browser while signed out, where the settings are out of reach */}
          <FieldSeparator />
          <DataSection />
        </FieldGroup>
      </form>
    </CenteredPage>
  );
}
