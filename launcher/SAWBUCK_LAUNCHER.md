# Sawbuck AI launcher

Turns the old "Start HoneyDone" command window into a real app icon. Double-click
the icon and you get the Sawbuck loading splash (hex logo, charcoal, yellow sweep)
while the server boots quietly in the background. When the app is ready, that same
window swaps straight into the app. No black command window.

## Set up the icon (one time)
1. Double-click **Create Sawbuck Icon.vbs** in the project folder (C:\Claude\handoff).
2. It drops a **Sawbuck AI** icon on your desktop and one in this folder.
3. Launch the app from that icon. Drag it onto the taskbar to pin it.

You can keep using the old **Start HoneyDone.bat** any time you want the visible
build log. Both run the exact same steps.

## How it works
- The icon runs **Start Sawbuck.vbs** through wscript, which has no console window.
- That script runs the same boot steps as the old batch (prisma db push, clear the
  old build, npm run build, npm run start), all hidden, with output saved to
  **launcher\boot.log** for support.
- It opens **launcher\boot.html** in a Chrome or Edge app window. That page is the
  splash. It quietly pings http://localhost:3000 and, the moment the server answers,
  swaps itself over to the app.

## Stopping the app
The server runs hidden, so closing the app window leaves it running (next launch is
then instant). To fully stop it, double-click **Stop Sawbuck.vbs**. Note: it closes
all local node processes, so quit it only when you are done with the app.

## Notes
- First launch builds the app and can take about a minute. The splash covers that
  wait. Later launches are faster.
- If the splash sits for a long time, open **launcher\boot.log** to see what the
  build reported, or run **Start HoneyDone.bat** once to watch it live.
- The in-app splash inside the app still shows the old HoneyDone mark. Say the word
  and I will switch that, the rail logo, and the browser tab title over to the hex
  so the whole app matches.
