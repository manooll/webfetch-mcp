[![MSeeP.ai Security Assessment Badge](https://mseep.net/pr/manooll-webfetch-mcp-badge.png)](https://mseep.ai/app/manooll-webfetch-mcp)

# 🌐 WebFetch.MCP v0.1.8

**Live Web Access for Your Local AI — Tunable Search & Clean Content Extraction**

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg) ![Node.js 18+](https://img.shields.io/badge/Node.js-18+-blue.svg) ![LM Studio Compatible](https://img.shields.io/badge/LM%20Studio-Compatible-purple.svg) ![SearxNG Powered](https://img.shields.io/badge/SearxNG-Powered-orange.svg)

# 🚨 The Problem
**Local LLMs can't browse the web.** Out of the box, LM Studio — and most MCP setups — leave your model stuck in **2023 or earlier**. No live data. No current events. Paste a URL into chat and all you get back is:

*"I can't access the web."*
A few third-party MCP servers exist, but they're API-locked, incomplete, or a pain to run. That means LM Studio users are flying blind — unable to fetch or search live content reliably.

# ✅ The Solution — WebFetch.MCP
**WebFetch.MCP** is a drop-in, self-hosted MCP server that brings your local AI:
* 🕒 **Fresh, Real-Time Data** — Go beyond your model's training cutoff.
* 🌐 **Reliable URL Fetch** — Paste a link, get the clean content.
* 🎛 **Full Search Control** — Choose engines, boost sources, filter by type/date/language.
* 🔓 **API-Free Freedom** — No API keys, quotas, or tracking.
* 🧠 **AI-Ready Output** — Structured, clean, distraction-free text your LLM can actually use.

**Privacy Note:** Search requests and web fetches are visible to your ISP and target sites. Use a VPN for enhanced privacy.

# 🏆 Why It's Different
| **Feature** | **WebFetch.MCP** | **mrkrsl-web-search** | **mcp-server-fetch-python** | **Crawl4AI** |
|:-:|:-:|:-:|:-:|:-:|
| Live Web Search | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| URL Content Fetch | ✅ Yes | ⚠️ Limited | ✅ Yes | ✅ Yes |
| Search Tunability | ✅ Full Control | ❌ API-limited | ❌ Basic | ⚠️ Limited |
| 70+ Search Engines | ✅ Yes | ❌ No | ❌ No | ⚠️ Few |
| Scientific/Technical Focus | ✅ Configurable | ❌ No | ❌ No | ❌ No |
| No API Keys | ✅ Yes | ❌ Required | ❌ Required | ✅ Basic only |
| Content Quality | ✅ Mozilla Readability | ⚠️ Basic | ⚠️ Basic | ✅ Advanced |
| JS Execution | ✅ Yes (JSDOM) | ❌ No | ✅ Yes | ✅ Yes |
| Setup Simplicity | ✅ Easy | ⚠️ Medium | ❌ Complex | ❌ Very Complex |
| Cost | ✅ Free | 💰 API costs | 💰 API costs | ✅ Free |

# ✨ Core Features
### 🎯 Precision Search
* **70+ configurable engines** — Google Scholar, arXiv, PubMed, IEEE, GitHub, Stack Overflow, weather.gov, and more.
* **Weighted source control** — Boost authoritative and academic sources.
* **Data type filters** — Papers, docs, code, or news only.
* **Freshness filters** — Recent publications, latest docs, breaking news.

### 🔬 Scientific & Technical Focus
* Academic: arXiv, PubMed, IEEE Xplore, ACM Digital Library.
* Technical: MDN, Stack Overflow, GitHub, official docs.
* Government: weather.gov, data.gov, NASA, NOAA.

### 📄 Clean Content Extraction
* Mozilla Readability — industry-standard parsing.
* JavaScript execution — handles SPAs & dynamic pages.
* Removes ads, menus, widgets.
* Optimized handling for research papers & technical docs.

### ⚙️ Complete Control
* Enable only trusted engines.
* Language & region targeting.
* Domain/site restrictions.
* Custom weighting per source.

# 📋 Prerequisites
* **Node.js 18+** → [Download](https://nodejs.org/)
* **Docker & Docker Compose** → [Install](https://docs.docker.com/get-docker/)
* **LM Studio** → [Download](https://lmstudio.ai/)
# ⚡ Quick Start
### 1️⃣ Install SearxNG (5 min)
**Docker Compose (Recommended)**
```bash
git clone https://github.com/searxng/searxng-docker.git
cd searxng-docker
sed -i "s|ultrasecretkey|$(openssl rand -hex 32)|g" searxng/settings.yml
docker compose up -d
```

**Test SearxNG**
```bash
curl "http://localhost:8080/search?q=test&format=json"
```

📖 [SearxNG Installation Guide](https://docs.searxng.org/admin/installation-docker.html)

### 2️⃣ Install WebFetch.MCP
```bash
git clone https://github.com/manooll/webfetch-mcp.git
cd webfetch-mcp
npm install
node server.mjs
```

### 3️⃣ Connect to LM Studio
In **LM Studio → Settings → Developer → MCP Servers**:
```json
{
  "mcpServers": {
    "webfetch": {
      "command": "node",
      "args": ["/full/path/to/webfetch-mcp/server.mjs"],
      "env": {
        "SEARXNG_BASE": "http://localhost:8080",
        "DEBUG": "false"
      }
    }
  }
}
```
Restart LM Studio — web_search and web_fetch tools will now be available.

### 4️⃣ Test It
In LM Studio:
```
🔍 Search for recent AI research on transformer architectures
📄 Fetch content from https://example.com/article
```

# 🔧 Configuration
| **Variable** | **Default** | **Description** |
|:-:|:-:|:-:|
| SEARXNG_BASE | http://localhost:8080 | SearxNG instance URL |
| DEBUG | false | Debug logging |
| DETAILED_LOG | true | Detailed log output |

# ⏱️ Smart Rate Limiting
WebFetch.MCP uses intelligent time-based rate limiting designed for real research workflows:

### **📊 Rate Limits:**
- **12 calls per 5-minute window** - Generous limit for research sessions
- **8 calls per 30-second burst** - Prevents LLM spam while allowing quick queries
- **Automatic reset** - No need to restart LM Studio between research sessions

### **🎯 Why This Works Better:**
- ✅ **Research-friendly** - Supports extended research sessions
- ✅ **Anti-spam protection** - Prevents runaway LLM tool calling
- ✅ **No restarts needed** - Limits reset automatically over time
- ✅ **Clear feedback** - Shows remaining calls and reset times

### **📈 Example Usage Patterns:**
- **Quick research**: 5-8 rapid calls, then brief pause
- **Extended research**: 12 calls spread over 5 minutes
- **Continuous work**: Limits reset as you work, no interruption

# 📊 Example Usage
**Search**
```
🔍 Find Python asyncio docs site:python.org
🔍 Search for recent climate data from government sources
```

**Fetch**
```
📄 Extract content from https://news.example.com/article
📄 Get main text from https://arxiv.org/abs/2305.12345
```

# 🧪 Testing
```bash
curl "http://localhost:8080/search?format=json&q=test&count=5"
DEBUG=true node server.mjs
```

# 🤝 Contributing
We welcome:
* 🐛 Bug reports → [Open an issue](https://github.com/manooll/webfetch-mcp/issues)
* 🔧 Code PRs
* 📖 Documentation improvements

# 📄 License
MIT — see [LICENSE](LICENSE).

# 🙏 Acknowledgments
* **[SearxNG](https://docs.searxng.org/)** — Privacy-focused metasearch engine.
* **[Mozilla Readability](https://github.com/mozilla/readability)** — Clean content extraction.
* **[LM Studio](https://lmstudio.ai/)** — Local AI runtime.
* **[Model Context Protocol](https://github.com/modelcontextprotocol)** — AI tool integration standard.

---
**Built for LM Studio and local LLM users who need real-time, reliable, tunable access to the web.**

⭐ **Star this repo** if you're done with *"I can't access the web"* from your AI.