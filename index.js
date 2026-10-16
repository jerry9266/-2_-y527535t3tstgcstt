const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_URL = "https://downloadwella.com/u8yg9cg1fnti";

app.use(express.json());

let browser;
let page;
let busy = false;
let state = "loading";
let downloadUrl = null;

async function initialize() {
    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext({
        acceptDownloads: true
    });

    page = await context.newPage();

    await page.goto(SOURCE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000
    });

    state = "create";
}

async function findButton(name) {
    const controls = page.locator(
        "button, a, [role='button'], input[type='button'], input[type='submit']"
    );

    for (let i = 0; i < await controls.count(); i++) {
        const el = controls.nth(i);

        if (!(await el.isVisible().catch(() => false))) continue;

        const text = (
            await el.innerText().catch(() => "")
        ).trim() || await el.getAttribute("value") || "";

        if (new RegExp(name, "i").test(text)) {
            return el;
        }
    }

    return null;
}

async function inspectState() {
    if (await findButton("^start download$")) {
        state = "start";
    } else if (await findButton("^create download link$")) {
        state = "create";
    } else if (await findButton("^create download$")) {
        state = "create";
    }

    return state;
}

app.get("/", (req, res) => {
    res.type("html").send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Download Controller</title>
<style>
body {
    margin: 0;
    padding: 25px;
    background: #0b0b10;
    color: white;
    font-family: Arial, sans-serif;
}
main {
    max-width: 420px;
    margin: 60px auto;
    padding: 22px;
    border-radius: 15px;
    background: #191921;
}
button {
    width: 100%;
    padding: 15px;
    margin: 10px 0;
    border: 0;
    border-radius: 9px;
    background: #ff5216;
    color: white;
    font-size: 16px;
    font-weight: bold;
}
#result {
    overflow-wrap: anywhere;
    color: #8bffb0;
}
</style>
</head>
<body>
<main>
    <h2>Download</h2>
    <button id="action" onclick="clickAction()" disabled>
        Loading...
    </button>
    <p id="status">Connecting to browser...</p>
    <p id="result"></p>
</main>

<script>
const action = document.getElementById("action");
const status = document.getElementById("status");
const result = document.getElementById("result");

async function refresh() {
    try {
        const response = await fetch("/api/state");
        const data = await response.json();

        action.disabled = !data.ready || data.busy;

        if (data.state === "create") {
            action.textContent = "Create Download";
        } else if (data.state === "start") {
            action.textContent = "Start Download";
        } else {
            action.textContent = "Please wait...";
            action.disabled = true;
        }

        status.textContent = data.message || "Ready";

        if (data.downloadUrl) {
            result.textContent = data.downloadUrl;
        }
    } catch {
        status.textContent = "Server connection failed.";
    }
}

async function clickAction() {
    action.disabled = true;
    status.textContent = "Processing...";

    try {
        const response = await fetch("/api/click", {
            method: "POST"
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.error);

        status.textContent = data.message || "Updated";
        if (data.downloadUrl) {
            result.textContent = data.downloadUrl;
        }
    } catch (error) {
        status.textContent = error.message || "Action failed";
    }

    await refresh();
}

refresh();
setInterval(refresh, 1500);
</script>
</body>
</html>
`);
});

app.get("/api/state", async (req, res) => {
    if (page && !page.isClosed() && !busy) {
        await inspectState().catch(() => {});
    }

    res.json({
        ready: !!page && !page.isClosed(),
        busy,
        state,
        downloadUrl,
        message: state === "start"
            ? "Start Download is ready."
            : state === "create"
                ? "Create Download is ready."
                : "Waiting for the browser."
    });
});

app.post("/api/click", async (req, res) => {
    if (busy) {
        return res.status(409).json({
            error: "An action is already running."
        });
    }

    busy = true;

    try {
        if (!page || page.isClosed()) {
            throw new Error("Browser session is unavailable.");
        }

        await inspectState();

        const expectedName = state === "create"
            ? /create download(?: link)?/i
            : /start download/i;

        const control = await findButton(expectedName.source);

        if (!control) {
            throw new Error(
                "The expected button was not found on the source page."
            );
        }

        // If Start Download is a link, capture its actual destination.
        if (state === "start") {
            const tag = await control.evaluate(
                el => el.tagName.toLowerCase()
            );

            let href = tag === "a"
                ? await control.getAttribute("href")
                : null;

            if (!href) {
                href = await control.locator("a[href]")
                    .first()
                    .getAttribute("href")
                    .catch(() => null);
            }

            if (href) {
                downloadUrl = new URL(href, page.url()).href;

                return res.json({
                    success: true,
                    state,
                    downloadUrl,
                    message: "Download link captured."
                });
            }
        }

        const beforeUrl = page.url();

        const downloadPromise = page.waitForEvent("download", {
            timeout: 15000
        }).catch(() => null);

        const responsePromise = page.waitForResponse(response =>
            /attachment/i.test(
                response.headers()["content-disposition"] || ""
            )
        , { timeout: 15000 }).catch(() => null);

        await control.click();

        if (state === "create") {
            await page.waitForFunction(() =>
                [...document.querySelectorAll(
                    "button, a, [role='button'], input"
                )].some(el =>
                    el.getClientRects().length &&
                    /start download/i.test(
                        (el.innerText || el.value || "").trim()
                    )
                ), { timeout: 20000 }
            ).catch(() => {});

            await inspectState();

            if (state !== "start") {
                state = "waiting";
            }

            return res.json({
                success: true,
                state,
                message: state === "start"
                    ? "Start Download is ready."
                    : "The page has not exposed Start Download yet."
            });
        }

        const [download, downloadResponse] = await Promise.all([
            downloadPromise,
            responsePromise
        ]);

        if (downloadResponse) {
            downloadUrl = downloadResponse.url();
        }

        // A download event does not itself expose the source URL.
        // Inspect browser requests if the response URL wasn't captured.
        if (!downloadUrl && page.url() !== beforeUrl) {
            downloadUrl = page.url();
        }

        return res.json({
            success: true,
            state: "done",
            downloadUrl,
            message: downloadUrl
                ? "Download URL captured."
                : download
                    ? "Download initiated, but its URL was not exposed."
                    : "The button was clicked; no URL was detected."
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        busy = false;
    }
});

app.listen(PORT, "0.0.0.0", async () => {
    console.log("Server listening on port " + PORT);

    try {
        await initialize();
        console.log("Source page loaded.");
    } catch (error) {
        state = "error";
        console.error("Browser initialization failed:", error.message);
    }
});

async function shutdown() {
    if (browser) await browser.close().catch(() => {});
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);