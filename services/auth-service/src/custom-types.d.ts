interface AuthUser {
    id: string;
    name: string;
    email: string;
    tv?: number;
}

declare namespace Express {
    export interface Request {
        user?: AuthUser;
    }
}
