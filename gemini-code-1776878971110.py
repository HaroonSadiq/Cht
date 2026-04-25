from weasyprint import HTML

# Defining the high-level engineering blueprint for the ManyChat Clone
html_content = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        @page {
            size: A4;
            margin: 15mm;
            background-color: #ffffff;
        }
        body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            font-size: 10pt;
            color: #1a1a1a;
            line-height: 1.6;
        }
        .header {
            background-color: #000000;
            color: #ffffff;
            padding: 30px;
            text-align: center;
            border-radius: 5px;
        }
        h1 { margin: 0; font-size: 22pt; letter-spacing: 1px; }
        h2 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 5px; margin-top: 30px; }
        h3 { color: #333; background: #f0f0f0; padding: 5px 10px; border-radius: 3px; }
        
        .code-block {
            background-color: #272822;
            color: #f8f8f2;
            padding: 15px;
            border-radius: 5px;
            font-family: 'Courier New', Courier, monospace;
            font-size: 9pt;
            overflow: hidden;
            margin: 15px 0;
        }
        .tech-tag {
            display: inline-block;
            background: #e1f5fe;
            color: #01579b;
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 8pt;
            margin-right: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 10px;
            text-align: left;
        }
        th { background-color: #f8f9fa; font-weight: bold; }
        .step-list {
            counter-reset: step-counter;
            list-style: none;
            padding-left: 0;
        }
        .step-list li {
            counter-increment: step-counter;
            margin-bottom: 15px;
            padding-left: 45px;
            position: relative;
        }
        .step-list li::before {
            content: counter(step-counter);
            position: absolute;
            left: 0;
            top: 0;
            background: #1a73e8;
            color: white;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            text-align: center;
            line-height: 30px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>ManyChat Clone: Engineering Blueprint</h1>
        <p>FAANG-Level Architecture & Implementation Guide</p>
    </div>

    <section>
        <h2>1. System Architecture (Event-Driven)</h2>
        <p>To handle millions of messages across Instagram and WhatsApp, the system must be decoupled using an event-driven approach.</p>
        <ul>
            <li><strong>Ingress Layer:</strong> Vercel Edge Functions (Lowest latency for Meta Webhooks).</li>
            <li><strong>Message Broker:</strong> Upstash Redis (Serverless Queue) or Apache Kafka for massive scale.</li>
            <li><strong>Flow Engine:</strong> Node.js/Go Workers that traverse the state machine.</li>
            <li><strong>Egress Layer:</strong> Meta Graph API / WhatsApp Business API Client.</li>
        </ul>
    </section>

    <section>
        <h2>2. Database Design (PostgreSQL)</h2>
        <p>A relational schema for high data integrity regarding users and their conversation states.</p>
        <div class="code-block">
<pre>
-- Core Subscriber Identity
CREATE TABLE subscribers (
    id UUID PRIMARY KEY,
    platform_id VARCHAR(100) UNIQUE, -- PSID for FB, Phone for WA
    platform_type ENUM('whatsapp', 'instagram', 'messenger'),
    attributes JSONB, -- Stores tags, email, name
    created_at TIMESTAMP DEFAULT NOW()
);

-- Conversation State Machine
CREATE TABLE convo_state (
    subscriber_id UUID REFERENCES subscribers(id),
    flow_id UUID,
    current_node_id VARCHAR(50),
    last_input_at TIMESTAMP,
    PRIMARY KEY (subscriber_id)
);
</pre>
        </div>
    </section>

    <section>
        <h2>3. Implementation: Webhook Logic</h2>
        <p>The following logic ensures Meta receives a 200 OK immediately while the message is processed in the background.</p>
        <div class="code-block">
<pre>
// Vercel /api/webhook/whatsapp.ts
export async function POST(req: Request) {
    const payload = await req.json();
    
    // 1. Validate X-Hub-Signature-256 (CRITICAL)
    // 2. Push payload to Redis Queue
    await redis.lpush("msg_queue", JSON.stringify(payload));
    
    // 3. Fast Response (Under 2 seconds)
    return new Response("ACK", { status: 200 });
}
</pre>
        </div>
    </section>

    <section>
        <h2>4. The Automation SaaS Stack (Vercel +)</h2>
        <table>
            <tr>
                <th>Component</th>
                <th>Technology Recommended</th>
            </tr>
            <tr>
                <td><strong>Frontend UI</strong></td>
                <td>Next.js 14, Tailwind CSS, Shadcn UI</td>
            </tr>
            <tr>
                <td><strong>Visual Builder</strong></td>
                <td>React Flow (Professional Grade for Canvas)</td>
            </tr>
            <tr>
                <td><strong>Database</strong></td>
                <td>Supabase (PostgreSQL) + Prisma ORM</td>
            </tr>
            <tr>
                <td><strong>Background Jobs</strong></td>
                <td>Inngest or BullMQ (Running on Railway/AWS)</td>
            </tr>
            <tr>
                <td><strong>Caching</strong></td>
                <td>Redis (for Rate Limiting & Session State)</td>
            </tr>
        </table>
    </section>

    <section>
        <h2>5. 4-Phase Roadmap for Developers</h2>
        <ul class="step-list">
            <li>
                <strong>The Foundation:</strong> Set up Meta Business Suite API. Create a secure webhook that authenticates requests and logs them to a database.
            </li>
            <li>
                <strong>Visual Flow Serialization:</strong> Build a drag-and-drop UI where nodes (Message, Condition, Delay) generate a JSON schema. Save this JSON in Postgres.
            </li>
            <li>
                <strong>The Executor:</strong> Build a worker process that takes an incoming message, checks the JSON schema for a matching keyword or current state, and calls the Meta Send API.
            </li>
            <li>
                <strong>Advanced Features:</strong> Add AI Integration (OpenAI API), Broadcaster (Bulk Messaging with Rate-limit protection), and Stripe for subscription billing.
            </li>
        </ul>
    </section>

    <div style="margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; font-size: 8pt; color: #666;">
        Internal Architecture Document | Build Version 1.0.4
    </div>
</body>
</html>
"""

# Generate the PDF file
file_name = "ManyChat_Clone_Engineering_Blueprint.pdf"
HTML(string=html_content).write_pdf(file_name)

print(file_name)