import { authenticatedRequestHeaders, ensureOk } from "@/base/http";
import { getKV } from "@/base/kv";
import { apiURL } from "@/base/origins";
import { z } from "zod";
import { FamilyData } from "./family";
import { Subscription } from "./plan";

const BonusData = z.object({
    /**
     * List of bonuses applied for the user.
     */
    storageBonuses: z
        .object({
            type: z.string() /** The type of the bonus. */,
        })
        .array(),
});

/**
 * Information about bonuses applied to the user.
 */
export type BonusData = z.infer<typeof BonusData>;

/**
 * Zod schema for {@link UserDetails}
 */
const UserDetails = z.object({
    email: z.string(),
    usage: z.number(),
    fileCount: z.number().optional(),
    subscription: Subscription,
    familyData: FamilyData.optional(),
    storageBonus: z.number().optional(),
    bonusData: BonusData.optional(),
});

export type UserDetails = z.infer<typeof UserDetails>;

/**
 * Internal in-memory state shared by the functions in this module.
 *
 * This entire object will be reset on logout.
 */
class UserState {
    /**
     * An arbitrary token to identify the current login.
     *
     * It is used to discard stale completions.
     */
    id: number;

    constructor() {
        this.id = Math.random();
    }

    /**
     * Subscriptions to {@link UserDetails} updates attached using
     * {@link userDetailsSubscribe}.
     */
    userDetailsListeners: (() => void)[] = [];

    /**
     * Snapshot of the {@link UserDetails} returned by the
     * {@link userDetailsSnapshot} function.
     */
    userDetailsSnapshot: UserDetails | undefined;
}

/** State shared by the functions in this module. See {@link UserState}. */
let _state = new UserState();

export const logoutUserDetails = () => {
    _state = new UserState();
};

/**
 * Read in the locally persisted settings into memory, but otherwise do not
 * initate any network requests to fetch the latest values.
 *
 * This assumes that the user is already logged in.
 */
export const initUserDetails = async () => {
    return syncUserDetailsSnapshotWithLocalDB();
};
/**
 * Fetch the user's details from remote and save them in local storage for
 * subsequent lookup, and also update our in-memory snapshots.
 */
export const syncUserDetails = async () => {};

/**
 * Fetch user details from remote.
 */
export const getUserDetailsV2 = async () => {
    const res = await fetch(await apiURL("/users/details/v2"), {
        headers: await authenticatedRequestHeaders(),
    });
    ensureOk(res);
    return UserDetails.parse(await res.json());
};

const syncUserDetailsSnapshotWithLocalDB = async () => {
    const userDetails = UserDetails.parse(getKV("userDetails"));
};

/**
 * A function that can be used to subscribe to updates to {@link UserDetails}.
 *
 * [Note: Snapshots and useSyncExternalStore]
 *
 * This subscribe function, along with {@link userDetailsSnapshot}, is meant to
 * be used as arguments to React's {@link useSyncExternalStore}.
 *
 * @param callback A function that will be invoked whenever the result of
 * {@link settingsSnapshot} changes.
 *
 * @returns A function that can be used to clear the subscription.
 */
export const userDetailsSubscribe = (onChange: () => void): (() => void) => {
    _state.userDetailsListeners.push(onChange);
    return () => {
        _state.userDetailsListeners = _state.userDetailsListeners.filter(
            (l) => l != onChange,
        );
    };
};

/**
 * Return the last known, cached {@link UserDetails}.
 *
 * This, along with {@link userDetailsSubscribe}, is meant to be used as
 * arguments to React's {@link useSyncExternalStore}.
 */
export const settingsSnapshot = () => _state.settingsSnapshot;

const setSettingsSnapshot = (snapshot: Settings) => {
    _state.settingsSnapshot = snapshot;
    _state.settingsListeners.forEach((l) => l());
};

/**
 * Fetch the two-factor status (whether or not it is enabled) from remote.
 */
export const get2FAStatus = async () => {
    const res = await fetch(await apiURL("/users/two-factor/status"), {
        headers: await authenticatedRequestHeaders(),
    });
    ensureOk(res);
    return z.object({ status: z.boolean() }).parse(await res.json()).status;
};

/**
 * Disable two-factor authentication for the current user on remote.
 */
export const disable2FA = async () =>
    ensureOk(
        await fetch(await apiURL("/users/two-factor/disable"), {
            method: "POST",
            headers: await authenticatedRequestHeaders(),
        }),
    );
