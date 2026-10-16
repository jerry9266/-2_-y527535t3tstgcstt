const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Hardcoded source URL
const ORIGINAL_URL =
    "https://downloadwella.com/u8yg9cg1fnti";

app.use(express.json());

// Generated links are stored in memory.
const links = new Map();

// Fetch the original page.
// Node.js 18+ provides the built-in fetch API.
async function fetchOriginalPage() {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 20000);

    try {
        const response = await fetch(ORIGINAL_URL, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; PageRenderer/1.0)",
                "Accept": "text/html,application/xhtml+xml"
            }
        });

        if (!response.ok) {
            throw new Error(
                `The source website returned HTTP ${response.status}`
            );
        }

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("text/html")) {
            throw new Error(
                "The source URL did not return an HTML page."
            );
        }

        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

// Homepage and Create Link interface
app.get("/", (req, res) => {
    res.type("html").send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport"
          content="width=device-width, initial-scale=1">
    <title>DownloadWella Link Creator</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: Arial, sans-serif;
            color: white;
            background: #0b0b10;
        }

        .card {
            width: 100%;
            max-width: 440px;
            padding: 25px;
            background: #171720;
            border-radius: 15px;
        }

        h1 {
            font-size: 24px;
        }

        p {
            color: #b8b8c5;
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
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
        }

        button:disabled {
            opacity: 0.6;
        }

        .result {
            display: none;
            margin-top: 20px;
        }

        .result.show {
            display: block;
        }

        .link {
            padding: 12px;
            overflow-wrap: anywhere;
            background: #0b0b10;
            border: 1px solid #393943;
            border-radius: 8px;
            color: #8bffb0;
        }

        #status {
            margin-top: 15px;
            font-size: 14px;
            overflow-wrap: anywhere;
        }
    </style>
</head>

<body>
    <main class="card">
        <h1>DownloadWella</h1>

        <p>
            Create a link to the page served through this server.
        </p>

        <button id="createButton" onclick="createLink()">
            Create Link
        </button>

        <section id="result" class="result">
            <p>Your generated link:</p>
            <div id="link" class="link"></div>

            <button onclick="copyLink()">Copy Link</button>
            <button onclick="openLink()">Open Page</button>
        </section>

        <div id="status"></div>
    </main>

    <script>
        let generatedLink = "";

        async function createLink() {
            const button = document.getElementById("createButton");
            const status = document.getElementById("status");
            const result = document.getElementById("result");

            button.disabled = true;
            button.textContent = "Creating link...";
            status.textContent = "";
            result.classList.remove("show");

            try {
                const response = await fetch("/api/create-link", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({})
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || "Failed to create link.");
                }

                generatedLink = data.link;

                document.getElementById("link").textContent =
                    generatedLink;

                result.classList.add("show");
                status.textContent = "Link created successfully.";

                try {
                    await navigator.clipboard.writeText(generatedLink);
                    status.textContent =
                        "Link created and copied to clipboard.";
                } catch (_) {
                    // Copy remains available through the button.
                }

            } catch (error) {
                status.textContent = error.message;
            } finally {
                button.disabled = false;
                button.textContent = "Create Link";
            }
        }

        async function copyLink() {
            const status = document.getElementById("status");

            try {
                await navigator.clipboard.writeText(generatedLink);
                status.textContent = "Link copied.";
            } catch (_) {
                status.textContent =
                    "Clipboard unavailable. Select and copy the link manually.";
            }
        }

        function openLink() {
            if (generatedLink) {
                window.location.href = generatedLink;
            }
        }
    </script>
</body>
</html>
    `);
});

// Create a unique page link.
app.post("/api/create-link", (req, res) => {
    const id = crypto.randomBytes(12).toString("hex");

    links.set(id, {
        createdAt: Date.now()
    });

    // Use the configured public URL when deployed behind a proxy.
    const baseUrl = process.env.PUBLIC_BASE_URL
        ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, "")
        : `${req.protocol}://${req.get("host")}`;

    res.json({
        success: true,
        link: `${baseUrl}/view/${id}`
    });
});

// Fetch and serve the source HTML instead of redirecting.
app.get("/view/:id", async (req, res) => {
    const record = links.get(req.params.id);

    if (!record) {
        return res.status(404).send("Link not found or expired.");
    }

    // Expire links after 24 hours.
    if (Date.now() - record.createdAt > 24 * 60 * 60 * 1000) {
        links.delete(req.params.id);
        return res.status(410).send("This link has expired.");
    }

    try {
        const html = await fetchOriginalPage();

        res.status(200);
        res.set("Content-Type", "text/html; charset=utf-8");
        res.set("Cache-Control", "no-store");

        // Do not strip or override the source site's security headers
        // by pretending that this basic fetch is a complete proxy.
        res.send(html);

    } catch (error) {
        console.error("Page fetch failed:", error.message);

        res.status(502).type("html").send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport"
                      content="width=device-width, initial-scale=1">
                <title>Page Loading Error</title>
            </head>
            <body style="font-family:Arial,sans-serif;padding:24px">
                <h2>Unable to load the page</h2>
                <p>
                    The source website could not be retrieved.
                    It may be unavailable or may require additional
                    browser functionality.
                </p>
                <p>Please try again later.</p>
            </body>
            </html>
        `);
    }
});

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
});