/**
 * Fixes technical terms that speech recognition commonly mishears ("Cuba needs" → Kubernetes,
 * "cube cuddle" → kubectl). Applied to every transcript line, so both the transcript the user
 * reads and the question the AI answers use the right words. Small local models cannot reliably
 * work these out themselves. Patterns are deliberately narrow: each one only matches sound-alikes
 * that are very unlikely to be meant literally in a technical conversation.
 */
const FIXES: [RegExp, string][] = [
  [/\b(?:cuba ?n(?:ee|ea|e)ds|cuban? eats|cuber ?needs|cubanets|cube ?a?net(?:e|i)?s|cooper ?net(?:t)?(?:ie|ee)s|kuber ?net(?:e|i)s|kubernetis)\b/gi, 'Kubernetes'],
  [/\b(?:cube|kube) ?(?:ctl|cuttle|cuddle|control|c\.? ?t\.? ?l\.?)\b|\b(?:cubect[a-z]*|kubectil|kubectyl|cube[ck]til)\b/gi, 'kubectl'],
  [/\bpost[- ]?gre(?:s|sh|ss)?[- ]?(?:q\.? ?l\.?|sequel)\b|\bpost[- ]?(?:gresh|gress)\b/gi, 'PostgreSQL'],
  [/\bmongo[- ]?d\.? ?b\.?\b/gi, 'MongoDB'],
  [/\bmy[- ]?sequel\b/gi, 'MySQL'],
  [/\bno[- ]?sequel\b/gi, 'NoSQL'],
  [/\bgraph[- ]?q\.? ?l\.?\b/gi, 'GraphQL'],
  [/\bg\.? ?r\.? ?p\.? ?c(?=\W|$)/gi, 'gRPC'],
  [/\b(?:o|oh)[- ]auth\b/gi, 'OAuth'],
  [/\bengine[- ]?x\b/gi, 'Nginx'],
  [/\bterra[- ]form\b/gi, 'Terraform'],
  [/\bjen[- ]kins\b/gi, 'Jenkins'],
  [/\bdev[- ]ops\b/gi, 'DevOps'],
  [/\bgit[- ]hub\b/gi, 'GitHub'],
  [/\bgit[- ]lab\b/gi, 'GitLab'],
  [/\bci[- /]?cd\b/gi, 'CI/CD'],
  [/\b(?:cap) theorem\b/gi, 'CAP theorem'],
  [/\bsolid principle(s?)\b/gi, 'SOLID principle$1'],
  [/\bacid (properties|transactions|compliance)\b/gi, 'ACID $1'],
  [/\brest(?:ful)? api(s?)\b/gi, 'REST API$1']
]

export function fixTechTerms(text: string): string {
  let out = text
  for (const [re, to] of FIXES) out = out.replace(re, to)
  return out
}
