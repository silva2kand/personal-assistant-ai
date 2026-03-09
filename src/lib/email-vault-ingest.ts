import { db } from '@/lib/db'
import { extractDocumentText, saveVaultFile } from '@/lib/document-vault'
import { getGmailMessageAttachments } from '@/lib/gmail-api'
import { getOutlookMessageAttachments } from '@/lib/outlook-graph'

function mapCategory(classifiedAs?: string | null): 'lease' | 'legal' | 'financial' | 'insurance' | 'contract' | 'general' {
  const c = String(classifiedAs || '').toLowerCase()
  if (c === 'solicitor') return 'legal'
  if (c === 'accountant') return 'financial'
  if (c === 'supplier') return 'contract'
  if (c === 'business') return 'general'
  return 'general'
}

function domainFromAddress(value: string): string {
  const p = value.split('@')[1] || ''
  return p.toLowerCase().trim()
}

export async function ingestImportantEmailsToVault(limit = 30): Promise<{ imported: number; skipped: number }> {
  const messages = await db.emailMessage.findMany({
    where: {
      classifiedAs: { in: ['solicitor', 'accountant', 'supplier', 'business'] },
    },
    orderBy: { date: 'desc' },
    take: Math.max(1, Math.min(limit, 200)),
  })

  let imported = 0
  let skipped = 0
  const maxAttachmentBytes = Math.max(
    100_000,
    Number(process.env.VAULT_EMAIL_ATTACHMENT_MAX_BYTES || 8 * 1024 * 1024)
  )
  const maxAttachmentsPerEmail = Math.max(
    1,
    Math.min(Number(process.env.VAULT_EMAIL_ATTACHMENTS_PER_MESSAGE || 10), 30)
  )

  for (const m of messages) {
    const sourceRef = `email:${m.id}`
    const exists = await db.vaultDocument.findFirst({
      where: { source: 'email', sourceRef, status: 'active' },
      select: { id: true },
    })
    if (exists) {
      skipped += 1
      continue
    }

    const content = [
      `From: ${m.fromAddress}`,
      `To: ${m.toAddress}`,
      `Subject: ${m.subject}`,
      `Date: ${m.date.toISOString()}`,
      '',
      m.body || '',
    ].join('\n')
    const bytes = Buffer.from(content, 'utf8')
    const stored = await saveVaultFile({
      fileName: `email-${m.provider}-${m.providerMessageId}.txt`,
      bytes,
    })
    const extracted = extractDocumentText({
      bytes,
      mimeType: 'text/plain',
      fileName: `email-${m.provider}-${m.providerMessageId}.txt`,
    })
    await db.vaultDocument.create({
      data: {
        title: `Email Snapshot: ${m.subject || '(No Subject)'}`,
        category: mapCategory(m.classifiedAs),
        tagsJson: JSON.stringify(
          [String(m.classifiedAs || 'general').toLowerCase(), m.provider.toLowerCase(), domainFromAddress(m.fromAddress)].filter(Boolean)
        ),
        summary: (m.body || '').replace(/\s+/g, ' ').slice(0, 240),
        relatedEntity: m.entityKey || null,
        source: 'email',
        sourceRef,
        storagePath: stored.storagePath,
        originalName: `email-${m.providerMessageId}.txt`,
        mimeType: 'text/plain',
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        extractedText: extracted.extractedText,
        extractionState: extracted.extractionState,
        uploadedBy: 'system-email-ingest',
        status: 'active',
      },
    })
    imported += 1

    try {
      const attachments =
        m.provider.toLowerCase() === 'gmail'
          ? await getGmailMessageAttachments(m.providerMessageId)
          : await getOutlookMessageAttachments(m.providerMessageId)

      let attached = 0
      for (const attachment of attachments) {
        if (attached >= maxAttachmentsPerEmail) break
        if (!attachment.fileName || attachment.sizeBytes <= 0) continue
        if (attachment.sizeBytes > maxAttachmentBytes) continue

        const attachmentSourceRef = `email-attachment:${m.id}:${m.provider}:${m.providerMessageId}:${attachment.fileName.toLowerCase()}`
        const already = await db.vaultDocument.findFirst({
          where: { source: 'email', sourceRef: attachmentSourceRef, status: 'active' },
          select: { id: true },
        })
        if (already) continue

        const storedAttachment = await saveVaultFile({
          fileName: attachment.fileName,
          bytes: attachment.bytes,
        })
        const extractedAttachment = extractDocumentText({
          bytes: attachment.bytes,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
        })

        await db.vaultDocument.create({
          data: {
            title: `Email Attachment: ${attachment.fileName}`,
            category: mapCategory(m.classifiedAs),
            tagsJson: JSON.stringify(
              [
                String(m.classifiedAs || 'general').toLowerCase(),
                m.provider.toLowerCase(),
                domainFromAddress(m.fromAddress),
                'attachment',
              ].filter(Boolean)
            ),
            summary: `Attachment from "${m.subject || '(No Subject)'}"`,
            relatedEntity: m.entityKey || null,
            source: 'email',
            sourceRef: attachmentSourceRef,
            storagePath: storedAttachment.storagePath,
            originalName: attachment.fileName,
            mimeType: attachment.mimeType || 'application/octet-stream',
            sizeBytes: storedAttachment.sizeBytes,
            sha256: storedAttachment.sha256,
            extractedText: extractedAttachment.extractedText,
            extractionState: extractedAttachment.extractionState,
            uploadedBy: 'system-email-ingest',
            status: 'active',
          },
        })
        imported += 1
        attached += 1
      }
    } catch {
      // Keep ingest resilient if attachment retrieval fails for a message.
    }
  }
  return { imported, skipped }
}
