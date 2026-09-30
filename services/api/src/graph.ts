export interface Person { type: "user" | "group"; id: string; name: string; email?: string }

type Fetch = typeof fetch;

/**
 * Reads people and groups from Microsoft Graph with the signed-in user's delegated token
 * (User.ReadBasic.All and GroupMember.Read.All, PRD section 8.3).
 */
export class GraphClient {
  constructor(private fetchImpl: Fetch = fetch, private base = "https://graph.microsoft.com/v1.0") {}

  private async get<T>(token: string, path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      headers: { authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
    });
    if (!res.ok) throw new Error(`Graph returned ${res.status}`);
    return res.json() as Promise<T>;
  }

  /** People picker search (IAM-5). The query goes into a quoted $search term, so strip quotes. */
  async search(token: string, query: string, limit = 8): Promise<Person[]> {
    const q = query.replace(/["\\]/g, "").trim();
    if (q.length < 2) return [];
    const term = encodeURIComponent(`"displayName:${q}" OR "mail:${q}"`);
    const [users, groups] = await Promise.all([
      this.get<{ value: { id: string; displayName: string; mail?: string }[] }>(token, `/users?$search=${term}&$select=id,displayName,mail&$top=${limit}`),
      this.get<{ value: { id: string; displayName: string }[] }>(token, `/groups?$search=${encodeURIComponent(`"displayName:${q}"`)}&$select=id,displayName&$top=${limit}`),
    ]);
    return [
      ...users.value.map((u): Person => ({ type: "user", id: u.id, name: u.displayName, email: u.mail })),
      ...groups.value.map((g): Person => ({ type: "group", id: g.id, name: g.displayName })),
    ];
  }

  /** Finds one person by exact email address, for matching migrated boards to their owners (MIG-5). */
  async findUserByEmail(token: string, email: string): Promise<Person | undefined> {
    // Anything that isn't a plain address can't match a person, and stays out of the filter.
    if (!/^[^\s'"\\<>()]+@[^\s'"\\<>()]+$/.test(email)) return undefined;
    const filter = encodeURIComponent(`mail eq '${email}' or userPrincipalName eq '${email}'`);
    const r = await this.get<{ value: { id: string; displayName: string; mail?: string; userPrincipalName?: string }[] }>(
      token, `/users?$filter=${filter}&$select=id,displayName,mail,userPrincipalName&$top=2`);
    const want = email.toLowerCase();
    const hit = r.value.find((u) => u.mail?.toLowerCase() === want || u.userPrincipalName?.toLowerCase() === want);
    return hit && { type: "user", id: hit.id, name: hit.displayName, email: hit.mail ?? email };
  }

  /** Resolves all group memberships for a user with more than 200 groups (IAM-9). */
  async memberGroups(token: string): Promise<string[]> {
    const ids: string[] = [];
    let path: string | undefined = "/me/transitiveMemberOf/microsoft.graph.group?$select=id&$top=999";
    while (path) {
      const page: { value: { id: string }[]; "@odata.nextLink"?: string } = await this.get(token, path);
      ids.push(...page.value.map((g) => g.id));
      path = page["@odata.nextLink"]?.replace(this.base, "");
    }
    return ids;
  }
}
