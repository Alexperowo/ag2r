# AG2R Security Guidelines

## 🔐 Critical Security Practices

### 1. Password Management

**NEVER use the default password in production.**

On first run, AG2R generates a cryptographically secure random password if none is provided. For production or tunnel access:

```bash
# Generate a strong password
openssl rand -base64 24

# Add to .env
APP_PASSWORD="your-generated-password-here"
SESSION_SECRET=$(openssl rand -hex 32)
```

**Password Requirements:**
- Minimum 16 characters
- Mix of uppercase, lowercase, numbers, and symbols
- Never reuse passwords from other services
- Store in a password manager

### 2. Environment Variables

**NEVER commit `.env` files to Git.**

The `.env` file contains sensitive credentials. Always:
- Copy `.env.example` to `.env` before first run
- Add `.env` to `.gitignore` (already included)
- Use different passwords for development and production

### 3. Debug Mode

**NEVER enable DEBUG_MODE in production.**

The `/eval` endpoint allows arbitrary JavaScript execution in the browser context. This is only for local development debugging.

```bash
# In .env - ALWAYS false for production/tunnel
DEBUG_MODE=false
```

### 4. Network Exposure

#### Local Network Only (Recommended)
For safest operation, use only on local Wi-Fi:
```bash
node server.js
# Access via https://192.168.x.x:3000
```

#### Quick Tunnels (Temporary)
For temporary remote access:
- Set a strong password FIRST
- Remember: URL changes on each restart
- Monitor access logs

#### Dedicated Tunnels (Production)
For permanent remote access:
- Use Cloudflare Tunnel with custom domain
- Enable Cloudflare's WAF (Web Application Firewall)
- Set up rate limiting
- Consider adding Cloudflare Access for additional auth

### 5. Rate Limiting

Enable rate limiting to prevent brute force attacks:

```bash
# In .env
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100   # 100 requests per window
```

Adjust based on your usage patterns.

### 6. HTTPS & Certificates

AG2R uses self-signed HTTPS certificates by default:
- Accept the certificate warning on first connection
- For production, consider using Let's Encrypt certificates
- Never disable HTTPS

### 7. CDP Security

Chrome DevTools Protocol (CDP) provides deep browser access:
- Only connect to trusted Antigravity instances
- Never expose CDP port (9000) to the internet
- Keep CDP on localhost (127.0.0.1)

```bash
# Correct: localhost only
CDP_HOST=127.0.0.1

# WRONG: Never do this
CDP_HOST=0.0.0.0  # ❌ Exposes CDP to network
```

### 8. Session Security

Sessions expire after 30 days by default. For enhanced security:
- Clear browser cookies when done
- Use private/incognito mode on shared devices
- Monitor active sessions in browser dev tools

### 9. Monitoring & Logging

Watch for suspicious activity:
- Failed login attempts in server logs
- Unusual request patterns
- Unexpected WebSocket connections

```bash
# Check logs regularly
tail -f ag2r.log | grep -E "(failed|error|unauthorized)"
```

### 10. Updates & Dependencies

Keep AG2R updated:
```bash
# Pull latest changes
git pull origin main

# Update dependencies
npm install

# Check for vulnerabilities
npm audit
npm audit fix
```

---

## 🚨 Security Checklist

Before deploying AG2R:

- [ ] Strong `APP_PASSWORD` set (not default)
- [ ] Cryptographic `SESSION_SECRET` generated
- [ ] `DEBUG_MODE=false` in production
- [ ] `.env` file NOT committed to Git
- [ ] Rate limiting enabled
- [ ] CDP restricted to localhost
- [ ] HTTPS enabled (self-signed or valid cert)
- [ ] Firewall configured (only necessary ports open)
- [ ] Regular dependency audits scheduled
- [ ] Backup plan for credential rotation

---

## 📞 Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** create a public GitHub issue
2. Email: security@ag2r.dev (future)
3. Wait for patch before public disclosure
4. We aim to respond within 48 hours

---

## 🔒 Incident Response

If you suspect a security breach:

1. **Immediately** change your `APP_PASSWORD`
2. Regenerate `SESSION_SECRET`
3. Restart the server
4. Clear all browser sessions
5. Review server logs for suspicious activity
6. Rotate any credentials that may have been exposed

---

*Security is a shared responsibility. Follow these guidelines to keep your AG2R instance secure.*
