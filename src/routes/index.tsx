import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { syncDiscordCommands } from "@/lib/discord/register.functions";
import {
  connectDiscordGateway,
  disconnectDiscordGateway,
  discordGatewayStatus,
} from "@/lib/discord/gateway.functions";



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discord Euro Casino Bot" },
      { name: "description", content: "Discord casino bot with euro balances, crypto deposits and withdrawals, mines, towers, upgrader, slots and blackjack." },
      { property: "og:title", content: "Discord Euro Casino Bot" },
      { property: "og:description", content: "Discord casino bot with euro balances, crypto deposits and withdrawals, mines, towers, upgrader, slots and blackjack." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});



function Index() {
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string>("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayConnecting, setGatewayConnecting] = useState(false);
  const [gatewaySession, setGatewaySession] = useState<string | null>(null);
  const sync = useServerFn(syncDiscordCommands);
  const connectGateway = useServerFn(connectDiscordGateway);
  const disconnectGateway = useServerFn(disconnectDiscordGateway);
  const statusGateway = useServerFn(discordGatewayStatus);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/public/discord/interactions`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await statusGateway();
        if (!cancelled) {
          setGatewayConnected(s.connected);
          setGatewaySession(s.sessionId ?? null);
        }
      } catch {
        if (!cancelled) setGatewayConnected(false);
      }
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [statusGateway]);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGatewayToggle = async () => {
    setGatewayConnecting(true);
    try {
      if (gatewayConnected) {
        await disconnectGateway();
        setGatewayConnected(false);
        setGatewaySession(null);
      } else {
        const result = await connectGateway();
        setGatewayConnected(result.connected);
        setGatewaySession(result.sessionId ?? null);
      }
    } catch (error) {
      setSyncResult(error instanceof Error ? error.message : "Gateway action failed");
    } finally {
      setGatewayConnecting(false);
    }
  };



  const handleSync = async () => {
    setSyncing(true);
    setSyncResult("");
    try {
      await sync();
      setSyncResult("Commands synced successfully!");
    } catch (error) {
      setSyncResult(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };


  return (
    <div className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Discord Gamble Bot</h1>
          <p className="mt-2 text-muted-foreground">
            A multiplayer economy bot for your Discord server. Register, bet, and climb the leaderboard.
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Setup instructions</h2>
          <ol className="list-decimal space-y-3 pl-5 text-card-foreground">
            <li>
              In the Discord Developer Portal, go to your bot app → <strong>General Information</strong> and paste the public key.
            </li>
            <li>
              Go to <strong>Installation</strong>, enable <strong>Guild Install</strong>, and copy the install link.
            </li>
            <li>
              Set the Interactions Endpoint URL to:
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm font-medium">
                  {webhookUrl || "..."}
                </code>
                <button
                  onClick={copyUrl}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </li>
            <li>
              Invite the bot to your server with the{" "}
              <strong>applications.commands</strong> scope.
            </li>
            <li>
              Click the button below to push the latest slash commands to Discord.
            </li>
          </ol>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {syncing ? "Syncing..." : "Sync slash commands"}
          </button>
          {syncResult && (
            <p className="mt-2 text-sm text-muted-foreground">{syncResult}</p>
          )}
        </div>


        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Available commands</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Command name="/register" description="Create an account with €1,000.00" />
            <Command name="/balance" description="Check your euro balance (private)" />
            <Command name="/daily" description="Claim €500.00 every 24 hours" />
            <Command name="/coinflip" description="Bet on heads or tails (public)" />
            <Command name="/slots" description="Spin the slot machine (public)" />
            <Command name="/blackjack" description="Play a hand against the dealer (public)" />
            <Command name="/mines" description="Reveal tiles, avoid the mines (public)" />
            <Command name="/towers" description="Climb the tower for a multiplier (public)" />
            <Command name="/upgrader" description="Gamble for a target multiplier (public)" />
            <Command name="/deposit" description="Get a BTC / ETH / LTC / USDT address (private)" />
            <Command name="/withdraw" description="Request a crypto payout (private)" />
            <Command name="/leaderboard" description="Top 10 richest players (private)" />
            <Command name="/setwallet" description="Admin: set the receiving wallet for a coin" />
            <Command name="/payouts" description="Admin: list, pay or reject withdrawals" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Command({ name, description }: { name: string; description: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="font-semibold text-foreground">{name}</div>
      <div className="text-sm text-muted-foreground">{description}</div>
    </div>
  );
}
