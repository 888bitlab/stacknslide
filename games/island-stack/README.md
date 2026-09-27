# Stack n Slide

A short physics game for Rare Friends. Generated character variants in the
collection's official visual style are dropped onto a floating island. Keep the
stack on the island for 30 seconds and score how many Friends are still there
at the end. FriendSDK still verifies the player's selected Friend for identity;
the falling characters are generated independently of that selection.

## Play locally

From the FriendSDK v0.1.2 repository root:

```sh
npm ci
npm run dev:game -- games/island-stack
```

Open the URL printed by the dev server, normally `http://localhost:4173`.
To test on a phone connected to the same Wi-Fi, run:

```sh
npm run dev:game -- games/island-stack --host 0.0.0.0 --port 4173
```

Then open `http://YOUR_COMPUTER_LAN_IP:4173` on the phone. Keep the development
server running. The SDK preview requires a browser wallet on Robinhood mainnet
(chain 4663) that owns an eligible hardwired Rare Friends Generations NFT
(generation 1 or higher). The wallet connection and fresh ownership check are
provided by the SDK runtime.

## Controls and rules

- Move the pointer or tap the playfield to aim.
- Press **Start Game** to begin the 30-second clock. During the run, tap
  anywhere on the playfield to drop a Friend. Press **Space** to drop as well.
- Characters fall under gravity, bump into one another and can slide/fall over
  the island's edge. They animate as they fall, rotate, squash slightly on
  impact, then blink and bob while resting. The
  score is the number still on the island when time ends.
- Choose **Play Again** to start another round. **R** also restarts after a run.
- Motion follows the device's reduced-motion preference.

Each drop asks FriendSDK's official family and seed renderer for a new randomized
sprite variant. The game compares the rendered frames against earlier drops in
the current round and retries collisions, so no appearance repeats during that
round. These generated visuals are not minted NFTs and do not imply ownership.
Game state and the best score are local to the active session; they reset when
the game reloads.

## Economy and integration

There are no RF costs, transfers, consumables, transactions or paid outcomes in
this prototype. The leaderboard is local to the browser. Its top-three rows
display the proposed 25 RF, 10 RF and 5 RF prizes, but the game does not award
or transfer those amounts. `game.json` contains a one-wei placeholder definition
only because the SDK CLI currently requires a valid chance-game definition to
mount the game; the component never calls its action client, so this definition
is not used in gameplay. A shared leaderboard and RF payouts need a server or
on-chain prize distribution integration.

FriendSDK **v0.1.2** supplies the wallet, Friend picker, fresh ownership check
and sandboxed game container. The game uses the SDK's public sprite reader for
canonical Friends artwork. No other third-party assets are included.

## Checks

Build and validate from the SDK root:

```sh
npm run build
npx friendsdk check games/island-stack
```

For a browser preview without a wallet, FriendSDK's test harness supports:

```sh
npx friendsdk test games/island-stack --width 360
```

The harness uses mock identity only for automated testing. A real preview still
requires the wallet and NFT described above.
