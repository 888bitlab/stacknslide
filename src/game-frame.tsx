"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatGameAmount } from "./experience-ui.js";
import { createFriendReader, spriteFrame } from "./friend-sprites.js";

/** Reference viewport dimensions; hosts may choose another layout through frame.css. */
export const GAME_VIEWPORT = Object.freeze({ width: 960, height: 640 });
export type GameFriend = Readonly<{ id: bigint; label: string; walletAddress?: string; kind: "owned" | "sample" }>;
export type GameWalletState = Readonly<{ balance?: bigint; status?: "ready" | "loading" | "error"; error?: string }>;
export type GameConfirmation = Readonly<{
  title: string; description: string; notice?: string; amount?: bigint; busy?: boolean; error?: string;
  onConfirm: () => void; onCancel: () => void;
}>;
export type GameFrameProps = {
  children: ReactNode; friends: readonly GameFriend[]; selectedFriendId: bigint | null;
  onSelectFriend?: (id: bigint) => void; friendsLoading?: boolean; friendsError?: string;
  /** Only show the empty result after successful discovery; null suppresses it. */
  friendsEmptyMessage?: string | null;
  friendsHiddenCount?: number;
  /** Use host when the surrounding interface already owns selection and connection. */
  selectionMode?: "picker" | "host";
  onConnect?: () => void; wallet?: GameWalletState; confirmation?: GameConfirmation | null;
  connection?: ReactNode; walletActions?: ReactNode;
  onDisconnect?: () => void;
  mode: "preview" | "live"; onMenuChange?: (open: boolean) => void;
};

function FriendAvatar({ friend }: { friend: GameFriend }) {
  const [rows, setRows] = useState<readonly string[] | null>(null);
  useEffect(() => {
    let active = true;
    setRows(null);
    void createFriendReader().read(friend.id).then(sprite => {
      if (active) setRows(spriteFrame(sprite, "down", false, 0).frame.rows);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [friend.id]);
  const path = rows?.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === "#" ? [`M${x} ${y}h1v1h-1z`] : [])).join("");
  return <svg className="rf-frame-avatar" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges">
    <rect width="16" height="16" fill="white" />{path && <path d={path} fill="black" />}
  </svg>;
}

/** An in-frame menu. Never portals into the website or opens a viewport-sized dialog. */
export function GameMenu({ title, onClose, children, footer }: { title: string; onClose?: () => void; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    node.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="rf-frame-scrim"><div ref={node} className="rf-frame-menu" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === "Escape" && onClose) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
      const first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node.current)) { event.preventDefault(); first.focus(); }
    }}>
    <header className="rf-frame-menu-heading"><h2 id={id}>{title}</h2>{onClose && <button type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button>}</header>
    <div className="rf-frame-menu-body">{children}</div>
    {footer && <footer className="rf-frame-menu-footer">{footer}</footer>}
  </div></div>;
}

export function GameFrame({ children, friends, selectedFriendId, onSelectFriend, friendsLoading, friendsError, friendsEmptyMessage = "No playable Friends found.", friendsHiddenCount = 0, onConnect, onDisconnect, wallet, confirmation, connection, walletActions, selectionMode = "picker", mode, onMenuChange }: GameFrameProps) {
  const [menu, setMenu] = useState<"friends" | "profile" | null>(null);
  const friend = friends.find(value => value.id === selectedFriendId);
  const selecting = selectionMode === "picker" && (!friend || menu === "friends");
  const menuOpen = selecting || menu === "profile" || Boolean(confirmation);
  const rfBalanceLabel = `Selected Friend’s ${mode === "preview" ? "simulated " : ""}$RAREFRIENDS balance`;
  useEffect(() => { onMenuChange?.(menuOpen); }, [menuOpen, onMenuChange]);
  return <section className="rf-game-frame" aria-label="Game container" data-mode={mode}>
    <div className="rf-frame-chrome" inert={menuOpen || undefined}>
      <div className="rf-frame-toolbar">
        {friend ? <button type="button" className="rf-frame-profile" onClick={() => setMenu("profile")} aria-label={`Open ${friend.label} profile`} title={friend.label}><FriendAvatar friend={friend} /><span className="rf-frame-sr-only">{friend.label}</span></button>
          : selectionMode === "host" ? <span className="rf-frame-selected-friend">Choose a Friend</span>
            : <button type="button" onClick={() => setMenu("friends")} aria-label="Choose Friend">Choose Friend</button>}
        {friend && wallet && <span className="rf-frame-rf-balance" role="status" title={rfBalanceLabel}
          aria-label={`${rfBalanceLabel}: ${wallet.status === "loading" ? "loading" : wallet.balance === undefined ? "unavailable" : `${formatGameAmount(wallet.balance, 18)} RF`}`}>
          <small>{mode === "preview" ? "SIM RF BALANCE" : "RF BALANCE"}</small><b>{wallet.status === "loading" ? "…" : wallet.balance === undefined ? "—" : formatGameAmount(wallet.balance, 18)}</b>
        </span>}
      </div>
      <div className="rf-frame-viewport">{children}</div>
    </div>
    {confirmation ? <GameMenu title={confirmation.title} onClose={confirmation.busy ? undefined : confirmation.onCancel}
      footer={<><button type="button" disabled={confirmation.busy} onClick={confirmation.onCancel}>Cancel</button><button type="button" className="rf-frame-primary" disabled={confirmation.busy} onClick={confirmation.onConfirm}>{confirmation.busy ? "Waiting…" : mode === "preview" ? "Confirm preview" : "Confirm"}</button></>}>
      <p>{confirmation.description}</p>{confirmation.amount !== undefined && <p><strong>{formatGameAmount(confirmation.amount, 18)} RF</strong></p>}
      {confirmation.notice && <p>{confirmation.notice}</p>}
      <p>{friend?.label}</p><p className="rf-frame-note">{mode === "preview" ? "Simulated RF. No transaction will be sent." : "This action uses the selected Friend’s canonical wallet. A result is confirmed only after its receipt."}</p>
      {confirmation.error && <p role="alert">{confirmation.error}</p>}
    </GameMenu> : selecting ? <GameMenu title="Choose your Friend" onClose={friend ? () => setMenu(null) : undefined}>
      {!connection && <p>{mode === "preview" ? !friends.some(value => value.kind === "sample") ? "Choose your Friend for this local preview. Balances, items and outcomes are simulated." : "Choose a sample Friend. Each has separate simulated balances and items." : "Choose an owned, hardwired Generations NFT. Its inventory and RF stay with its wallet."}</p>}
      {connection}
      {friendsLoading && <p role="status">Loading your Friends…</p>}
      {friendsError && <p role="alert">{friendsError}</p>}
      <div className="rf-frame-friends">{friends.map(value => <button type="button" key={value.id.toString()} aria-pressed={value.id === selectedFriendId} onClick={() => { onSelectFriend?.(value.id); setMenu(null); }}><strong>{value.label}</strong><small>{value.kind === "sample" ? "Sample · no ownership claim" : "Hardwired Generations"}</small></button>)}</div>
      {!friendsLoading && !friendsError && friendsHiddenCount > 0 && <p>{friendsHiddenCount} {friendsHiddenCount === 1 ? "Friend" : "Friends"} hidden: not hardwired (generation 0). Playing requires generation 1 or higher.</p>}
      {!friendsLoading && !friendsError && !friends.length && friendsEmptyMessage && <p>{friendsEmptyMessage}</p>}
      {onConnect && <button type="button" className="rf-frame-primary" onClick={onConnect}>Connect wallet</button>}
    </GameMenu> : menu === "profile" && friend ? <GameMenu title="Friend profile" onClose={() => setMenu(null)}>
      <div className="rf-frame-profile-summary"><FriendAvatar friend={friend} /><h3>{friend.label}</h3></div>
      <div className="rf-frame-profile-actions">
        <button type="button" disabled={selectionMode !== "picker" || !onSelectFriend} onClick={() => setMenu("friends")}>Select a new Friend</button>
        <button type="button" disabled={!onDisconnect} onClick={() => { setMenu(null); onDisconnect?.(); }}>Disconnect wallet</button>
      </div>
    </GameMenu> : null}
  </section>;
}
