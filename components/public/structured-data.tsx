import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/core/site'

function JsonLd({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
}

export function WebsiteStructuredData() {
  return (
    <JsonLd
      data={[
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: SITE_NAME,
          url: SITE_URL,
          description: SITE_DESCRIPTION,
          logo: `${SITE_URL}/icon`,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITE_NAME,
          url: SITE_URL,
          description: SITE_DESCRIPTION,
          inLanguage: 'ru-KZ',
          potentialAction: {
            '@type': 'SearchAction',
            target: `${SITE_URL}/?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        },
        {
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: SITE_NAME,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web, Windows',
          description: SITE_DESCRIPTION,
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'KZT',
          },
          url: SITE_URL,
        },
      ]}
    />
  )
}

export function FaqStructuredData({
  faq,
}: {
  faq: Array<{ question: string; answer: string }>
}) {
  if (faq.length === 0) return null

  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      }}
    />
  )
}

export function BreadcrumbStructuredData({
  items,
}: {
  items: Array<{ name: string; path: string }>
}) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: `${SITE_URL}${item.path}`,
        })),
      }}
    />
  )
}
