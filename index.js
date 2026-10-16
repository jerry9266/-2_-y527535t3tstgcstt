const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_URL =
    "https://downloadwella.com/u8yg9cg1fnti";

app.use(express.json());

let browser;
let context;
let page;
let busy = false;
let currentState = "idle";
let lastDownloadUrl = null;

function setState(state) {
    currentState = state;
}

async function initializeBrowser() {
    browser = await chromium.launch({
        headless: true
    });

    context = await browser.newContext({
        acceptDownloads: true
    });

    page = await context.newPage();

    page.setDefaultTimeout(20000);

    await page.goto(SOURCE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45000
    });

    console.log("Browser opened:", SOURCE_URL);
}

function findButton(text) {
    return page.getByText(text, {
        exact: false
    }).filter({
        visible: true
    }).first();
}

async function findVisibleControl(pattern) {
    const candidates = page.locator(
        "a, button, input[type='button'], input[type='submit'], [role='button']"
    );

    const count = await candidates.count();

    for (let i = 0; i < count; i++) {
        const element = candidates.nth(i);

        if (!(await element.isVisible())) {
            continue;
        }

        const label = (
            await element.innerText().catch(() => "")
        ).trim();

        const value = await element.getAttribute("value")
            .catch(() => "");

        const text = label || value || "";

        if (pattern.test(text)) {
            return element;
        }
    }

    return null;
}

async function getLinkFromControl(control) {
    if (!control) {
        return null;
    }

    const tag = await control.evaluate(
        element => element.tagName.toLowerCase()
    );

    if (tag === "a") {
        const href = await control.getAttribute("href");

        if (href) {
            return new URL(href, page.url()).href;
        }
    }

    const nestedLink = control.locator("a[href]").first();

    if (await nestedLink.count()) {
        const href = await nestedLink.getAttribute("href");

        if (href) {
            return new URL(href, page.url()).href;
        }
    }

    return null;
}

// Frontend
app.get("/", (req, res) => {
    res.type("html").send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1">

<title>Download Link Controller</title>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
    background: #0b0b10;
    color: white;
    font-family: Arial, sans-serif;
}

.card {
    width: 100%;
    max-width: 440px;
    padding: 24px;
    border-radius: 16px;
    background: #191921;
}

h1 {
    font-size: 23px;
}

p {
    color: #b6b6c2;
    line-height: 1.6;
}

button {
    width: 100%;
    padding: 14px;
    margin-top: 12px;
    border: 0;
    border-radius: 8px;
    background: #ff5216;
    color: white;
    font-size: 15px;
    font-weight: bold;
    cursor: pointer;
}

button:disabled {
    opacity: 0.5;
}

#startButton, #result {
    display: none;
}

#startButton.visible, #result.visible {
    display: block;
}

.output {
    overflow-wrap: anywhere;
    padding: 12px;
    border: 1px solid #40404b;
    border-radius: 8px;
    background: #0b0b10;
    color: #8bffb0;
}

#status {
    margin-top: 16px;
    font-size: 14px;
    overflow-wrap: anywhere;
}
</style>
</head>

<body>
<main class="card">
    <h1>Download Link Controller</h1>

    <p>
        Control the browser session and retrieve the
        resulting download URL.
    </p>

    <button id="createButton" onclick="createDownload()">
        Create Download
    </button>

    <button id="startButton" onclick="startDownload()">
        Start Download
    </button>

    <section id="result">
        <p>Download URL:</p>
        <div class="output" id="downloadUrl"></div>

        <button onclick="copyUrl()">Copy Download URL</button>
        <button onclick="openUrl()">Open Download URL</button>
    </section>

    <div id="status">Ready.</div>
</main>

<script>
const statusElement = document.getElementById("status");
const createButton = document.getElementById("createButton");
const startButton = document.getElementById("startButton");
const resultElement = document.getElementById("result");

let downloadUrl = "";

async function request(path) {
    const response = await fetch(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({})
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }

    return data;
}

async function createDownload() {
    createButton.disabled = true;
    statusElement.textContent =
        "Server is clicking Create Download...";

    try {
        const data = await request("/api/create-download");

        statusElement.textContent = data.message;

        if (data.state === "start-ready") {
            startButton.classList.add("visible");
        }
    } catch (error) {
        statusElement.textContent = error.message;
    } finally {
        createButton.disabled = false;
    }
}

async function startDownload() {
    startButton.disabled = true;
    statusElement.textContent =
        "Server is processing Start Download...";

    try {
        const data = await request("/api/start-download");

        if (data.downloadUrl) {
            downloadUrl = data.downloadUrl;

            document.getElementById("downloadUrl").textContent =
                downloadUrl;

            resultElement.classList.add("visible");

            statusElement.textContent =
                "Download URL retrieved.";
        } else {
            statusElement.textContent =
                data.message || "No download URL was detected.";
        }
    } catch (error) {
        statusElement.textContent = error.message;
    } finally {
        startButton.disabled = false;
    }
}

async function copyUrl() {
    if (!downloadUrl) return;

    try {
        await navigator.clipboard.writeText(downloadUrl);
        statusElement.textContent = "URL copied.";
    } catch (_) {
        statusElement.textContent =
            "Clipboard unavailable. Copy the displayed URL manually.";
    }
}

function openUrl() {
    if (downloadUrl) {
        window.open(downloadUrl, "_blank");
    }
}
</script>
</body>
</html>
    `);
});

// Step 1: Click Create download link.
app.post("/api/create-download", async (req, res) => {
    if (busy) {
        return res.status(409).json({
            error: "Another browser action is in progress."
        });
    }

    busy = true;

    try {
        if (!page || page.isClosed()) {
            await initializeBrowser();
        }

        const control = await findVisibleControl(
            /create\s+download\s+link/i
        );

        if (!control) {
            return res.status(404).json({
                error: "Create download link button was not found."
            });
        }

        await control.click();

        // Wait for the page to expose the next action.
        await page.waitForFunction(() => {
            const elements = Array.from(
                document.querySelectorAll(
                    "a, button, input, [role='button']"
                )
            );

            return elements.some(element => {
                const text = (
                    element.innerText ||
                    element.value ||
                    ""
                ).trim();

                return /start\s+download/i.test(text) &&
                    element.getClientRects().length > 0;
            });
        }, { timeout: 20000 }).catch(() => {});

        const startControl = await findVisibleControl(
            /start\s+download/i
        );

        if (!startControl) {
            setState("create-clicked");

            return res.json({
                success: true,
                state: currentState,
                message:
                    "Create action completed, but Start Download was not detected."
            });
        }

        setState("start-ready");

        res.json({
            success: true,
            state: currentState,
            message: "Start Download is ready."
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    } finally {
        busy = false;
    }
});

// Step 2: Click Start Download and capture a download URL.
app.post("/api/start-download", async (req, res) => {
    if (busy) {
        return res.status(409).json({
            error: "Another browser action is in progress."
        });
    }

    busy = true;

    try {
        if (!page || page.isClosed()) {
            throw new Error("Browser session is unavailable.");
        }

        const control = await findVisibleControl(
            /start\s+download/i
        );

        if (!control) {
            throw new Error(
                "Start Download button was not found."
            );
        }

        let capturedUrl = await getLinkFromControl(control);

        // If the control contains an actual link, return it.
        if (capturedUrl) {
            lastDownloadUrl = capturedUrl;

            return res.json({
                success: true,
                downloadUrl: capturedUrl,
                source: "link-element"
            });
        }

        // Otherwise, observe the download event while clicking.
        const downloadPromise = page.waitForEvent("download", {
            timeout: 20000
        }).catch(() => null);

        const responsePromise = page.waitForResponse(response => {
            const headers = response.headers();

            return (
                headers["content-disposition"] &&
                /attachment/i.test(headers["content-disposition"])
            );
        }, {
            timeout: 20000
        }).catch(() => null);

        await control.click();

        const download = await downloadPromise;

        if (download) {
            capturedUrl = download.url();
        }

        if (!capturedUrl) {
            const downloadResponse = await responsePromise;

            if (downloadResponse) {
                capturedUrl = downloadResponse.url();
            }
        }

        if (capturedUrl) {
            lastDownloadUrl = capturedUrl;

            return res.json({
                success: true,
                downloadUrl: capturedUrl,
                source: "download-event"
            });
        }

        res.status(404).json({
            success: false,
            error:
                "The action was performed, but no direct download URL was exposed."
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    } finally {
        busy = false;
    }
});

// Current browser state
app.get("/api/status", (req, res) => {
    res.json({
        state: currentState,
        downloadUrl: lastDownloadUrl
    });
});

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

async function shutdown() {
    if (browser) {
        await browser.close().catch(() => {});
    }

    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, "0.0.0.0", () => {
    console.log("Server listening on port " + PORT);
});