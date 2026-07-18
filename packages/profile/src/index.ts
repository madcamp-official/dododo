import type { ProfileRepository, UserProfile } from "../../shared/src/index.ts";

export class InMemoryProfileRepository implements ProfileRepository {
  private profile?: UserProfile;

  async get(): Promise<UserProfile | undefined> {
    return this.profile ? structuredClone(this.profile) : undefined;
  }

  async save(profile: UserProfile): Promise<void> {
    this.profile = structuredClone(profile);
  }
}
