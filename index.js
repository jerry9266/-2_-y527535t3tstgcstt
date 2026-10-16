const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Original URL
const ORIGINAL_URL =
  "https://downloadwella.com/u8yg9cg1fnti";

app.use(express.json());

// Store generated links in memory.
// Links will be lost if the server restarts.
const links = new Map();

// Frontend
app.get("/", (req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport"
          content="width=device-width, initial-scale=1.0">

    <title>Create Download Link</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            font-family: Arial, sans-serif;
            background: #0b0b10;
            color: white;
        }

        .card {
            width: 100%;
            max-width: 420px;
            padding: 25px;
            border-radius: 16px;
            background: #171720;
            box-shadow: 0 10px 40px #0005;
        }

        h1 {
            margin-top: 0;
            font-size: 24px;
        }

        p {
            color: #b7b7c3;
            line-height: 1.6;
        }

        button {
            width: 100%;
            padding: 14px;
            margin-top: 15px;
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
            cursor: wait;
        }

        .result {
            display: none;
            margin-top: 22px;
        }

        .result.show {
            display: block;
        }

        .link-box {
            padding: 12px;
            overflow-wrap: anywhere;
            border: 1px solid #363642;
            border-radius: 8px;
            background: #0b0b10;
            color: #8bffb0;
            line-height: 1.5;
        }

        .status {
            margin-top: 12px;
            font-size: 14px;
            color: #b7b7c3;
        }

        .error {
            color: #ff8585;
        }
    </style>
</head>

<body>
    <main class="card">
        <h1>Download Link Creator</h1>

        <p>
            Generate a link for the configured source URL.
        </p>

        <button id="createButton" onclick="createLink()">
            Create Link
        </button>

        <div id="result" class="result">
            <p>Your generated link:</p>

            <div id="generatedLink" class="link-box"></div>

            <button onclick="copyLink()">
                Copy Link
            </button>
        </div>

        <div id="status" class="status"></div>
    </main>

    <script>
        let currentLink = "";

        async function createLink() {
            const button = document.getElementById("createButton");
            const status = document.getElementById("status");
            const result = document.getElementById("result");

            button.disabled = true;
            button.textContent = "Creating...";
            status.textContent = "";
            status.className = "status";
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
                    throw new Error(
                        data.error || "Could not create the link."
                    );
                }

                currentLink = data.link;

                document.getElementById("generatedLink").textContent =
                    currentLink;

                result.classList.add("show");
                status.textContent = "Link created successfully.";

                // Automatically copy the link when possible.
                try {
                    await navigator.clipboard.writeText(currentLink);
                    status.textContent =
                        "Link created and copied to your clipboard.";
                } catch (_) {
                    // The user can still press the Copy Link button.
                }

            } catch (error) {
                status.textContent = error.message;
                status.className = "status error";
            } finally {
                button.disabled = false;
                button.textContent = "Create Link";
            }
        }

        async function copyLink() {
            const status = document.getElementById("status");

            try {
                await navigator.clipboard.writeText(currentLink);
                status.textContent = "Link copied successfully.";
                status.className = "status";
            } catch (_) {
                // Fallback for browsers without clipboard access.
                const input = document.createElement("textarea");
                input.value = currentLink;
                document.body.appendChild(input);
                input.select();

                const copied = document.execCommand("copy");
                input.remove();

                status.textContent = copied
                    ? "Link copied successfully."
                    : "Please copy the link manually.";

                status.className = copied
                    ? "status"
                    : "status error";
            }
        }
    </script>
</body>
</html>
    `);
});

// Create a unique link
app.post("/api/create-link", (req, res) => {
  const id = crypto.randomBytes(8).toString("hex");
  
  links.set(id, {
    originalUrl: ORIGINAL_URL,
    createdAt: new Date().toISOString()
  });
  
  const link = `${req.protocol}://${req.get("host")}/r/${id}`;
  
  res.json({
    success: true,
    link
  });
});

// Redirect generated links to the original URL.
// This does not proxy or render the original webpage.
app.get("/r/:id", (req, res) => {
  const record = links.get(req.params.id);
  
  if (!record) {
    return res.status(404).send("Link not found or expired.");
  }
  
  res.redirect(302, record.originalUrl);
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});