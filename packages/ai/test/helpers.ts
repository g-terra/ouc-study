// Small helpers shared by the tests.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/** The port a test server listens on. */
export const portOf = (server: Server): number => (server.address() as AddressInfo).port;

/** A response body as JSON, loosely typed: tests assert on its shape. */
export const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

/** A server-sent event, loosely typed. */
export type Ev = Record<string, any>;
