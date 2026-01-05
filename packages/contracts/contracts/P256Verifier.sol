pragma solidity ^0.8.20;

contract P256Verifier {
    fallback(bytes calldata input) external returns (bytes memory) {
        if (input.length != 160) {
            return abi.encodePacked(uint256(0));
        }

        bytes32 hash = bytes32(input[0:32]);
        uint256 r = uint256(bytes32(input[32:64]));
        uint256 s = uint256(bytes32(input[64:96]));
        uint256 x = uint256(bytes32(input[96:128]));
        uint256 y = uint256(bytes32(input[128:160]));

        uint256 ret = ecdsa_verify(hash, r, s, [x, y]) ? 1 : 0;

        return abi.encodePacked(ret);
    }

    uint256 constant p =
        0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF;
    uint256 constant a =
        0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC;
    uint256 constant b =
        0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B;
    uint256 constant GX =
        0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296;
    uint256 constant GY =
        0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5;
    uint256 constant n =
        0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 constant minus_2modp =
        0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFD;
    uint256 constant minus_2modn =
        0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC63254F;

    function ecdsa_verify(
        bytes32 message_hash,
        uint256 r,
        uint256 s,
        uint256[2] memory pubKey
    ) private view returns (bool) {
        if (r == 0 || r >= n || s == 0 || s >= n) {
            return false;
        }

        if (!ecAff_isValidPubkey(pubKey[0], pubKey[1])) {
            return false;
        }

        uint256 sInv = nModInv(s);

        uint256 scalar_u = mulmod(uint256(message_hash), sInv, n);
        uint256 scalar_v = mulmod(r, sInv, n);

        uint256 r_x = ecZZ_mulmuladd(pubKey[0], pubKey[1], scalar_u, scalar_v);
        return r_x % n == r;
    }

    function ecAff_isValidPubkey(uint256 x, uint256 y) internal pure returns (bool) {
        if (x >= p || y >= p || (x == 0 && y == 0)) {
            return false;
        }

        return ecAff_satisfiesCurveEqn(x, y);
    }

    function ecAff_satisfiesCurveEqn(uint256 x, uint256 y) internal pure returns (bool) {
        uint256 LHS = mulmod(y, y, p);
        uint256 RHS = addmod(mulmod(mulmod(x, x, p), x, p), mulmod(a, x, p), p);
        RHS = addmod(RHS, b, p);

        return LHS == RHS;
    }

    function ecZZ_mulmuladd(
        uint256 QX,
        uint256 QY,
        uint256 scalar_u,
        uint256 scalar_v
    ) private view returns (uint256) {
        if (scalar_u == 0 && scalar_v == 0) {
            return 0;
        }

        uint256[3] memory R;
        uint256[3] memory U;
        uint256[3] memory V;

        U = ecAff_toJac(GX, GY);
        V = ecAff_toJac(QX, QY);

        uint256 bitLenU = _msb(scalar_u);
        uint256 bitLenV = _msb(scalar_v);
        uint256 bitLen = bitLenU > bitLenV ? bitLenU : bitLenV;

        R[0] = 0;
        R[1] = 0;
        R[2] = 0;

        for (uint256 i = bitLen + 1; i > 0; i--) {
            R = ecJac_double(R[0], R[1], R[2]);

            uint256 bitIndex = i - 1;

            bool uBit = ((scalar_u >> bitIndex) & 1) == 1;
            bool vBit = ((scalar_v >> bitIndex) & 1) == 1;

            if (uBit && vBit) {
                uint256[3] memory W = ecJac_add(U[0], U[1], U[2], V[0], V[1], V[2]);
                R = ecJac_add(R[0], R[1], R[2], W[0], W[1], W[2]);
            } else if (uBit) {
                R = ecJac_add(R[0], R[1], R[2], U[0], U[1], U[2]);
            } else if (vBit) {
                R = ecJac_add(R[0], R[1], R[2], V[0], V[1], V[2]);
            }
        }

        if (R[2] == 0) {
            return 0;
        }

        (uint256 x, ) = ecJac_toAff(R[0], R[1], R[2]);
        return x;
    }

    function ecAff_toJac(uint256 x, uint256 y) private pure returns (uint256[3] memory R) {
        R[0] = x;
        R[1] = y;
        R[2] = 1;
    }

    function ecJac_toAff(
        uint256 X,
        uint256 Y,
        uint256 Z
    ) private view returns (uint256 x, uint256 y) {
        uint256 zInv = pModInv(Z);
        uint256 zInv2 = mulmod(zInv, zInv, p);
        uint256 zInv3 = mulmod(zInv2, zInv, p);
        x = mulmod(X, zInv2, p);
        y = mulmod(Y, zInv3, p);
    }

    function ecJac_double(
        uint256 X1,
        uint256 Y1,
        uint256 Z1
    ) private view returns (uint256[3] memory R) {
        if (Z1 == 0) {
            return [uint256(0), uint256(0), uint256(0)];
        }

        uint256 T1 = mulmod(X1, X1, p);
        uint256 T2 = mulmod(Y1, Y1, p);
        uint256 T3 = mulmod(T2, T2, p);
        uint256 T4 = mulmod(Z1, Z1, p);
        uint256 T5 = mulmod(X1, T2, p);

        uint256 S = addmod(T5, T5, p);
        S = addmod(S, S, p);

        uint256 M = addmod(T1, T1, p);
        M = addmod(M, T1, p);

        uint256 Z3 = mulmod(Y1, Z1, p);
        Z3 = addmod(Z3, Z3, p);

        uint256 X3 = mulmod(M, M, p);
        X3 = addmod(X3, minus_2modp * S % p, p);

        uint256 Y3 = addmod(S, p - X3, p);
        Y3 = mulmod(M, Y3, p);
        uint256 T6 = addmod(T3, T3, p);
        T6 = addmod(T6, T6, p);
        T6 = addmod(T6, T6, p);
        Y3 = addmod(Y3, p - T6, p);

        R[0] = X3;
        R[1] = Y3;
        R[2] = Z3;
    }

    function ecJac_add(
        uint256 X1,
        uint256 Y1,
        uint256 Z1,
        uint256 X2,
        uint256 Y2,
        uint256 Z2
    ) private view returns (uint256[3] memory R) {
        if (Z1 == 0) {
            return [X2, Y2, Z2];
        }
        if (Z2 == 0) {
            return [X1, Y1, Z1];
        }

        uint256 Z1Z1 = mulmod(Z1, Z1, p);
        uint256 Z2Z2 = mulmod(Z2, Z2, p);

        uint256 U1 = mulmod(X1, Z2Z2, p);
        uint256 U2 = mulmod(X2, Z1Z1, p);

        uint256 S1 = mulmod(Y1, mulmod(Z2, Z2Z2, p), p);
        uint256 S2 = mulmod(Y2, mulmod(Z1, Z1Z1, p), p);

        if (U1 == U2) {
            if (S1 != S2) {
                return [uint256(0), uint256(0), uint256(0)];
            }
            return ecJac_double(X1, Y1, Z1);
        }

        uint256 H = addmod(U2, p - U1, p);
        uint256 I = addmod(H, H, p);
        I = mulmod(I, I, p);
        uint256 J = mulmod(H, I, p);
        uint256 r = addmod(S2, p - S1, p);
        r = addmod(r, r, p);
        uint256 V = mulmod(U1, I, p);

        uint256 X3 = mulmod(r, r, p);
        X3 = addmod(X3, p - J, p);
        X3 = addmod(X3, p - addmod(V, V, p), p);

        uint256 Y3 = addmod(V, p - X3, p);
        Y3 = mulmod(r, Y3, p);
        uint256 S1J = mulmod(S1, J, p);
        S1J = addmod(S1J, S1J, p);
        Y3 = addmod(Y3, p - S1J, p);

        uint256 Z3 = addmod(Z1, Z2, p);
        Z3 = mulmod(Z3, Z3, p);
        Z3 = addmod(Z3, p - Z1Z1, p);
        Z3 = addmod(Z3, p - Z2Z2, p);
        Z3 = mulmod(Z3, H, p);

        R[0] = X3;
        R[1] = Y3;
        R[2] = Z3;
    }

    function pModInv(uint256 x) private view returns (uint256) {
        return expMod(x, p - 2, p);
    }

    function nModInv(uint256 x) private view returns (uint256) {
        return expMod(x, n - 2, n);
    }

    function expMod(uint256 base, uint256 e, uint256 m) private view returns (uint256) {
        uint256 result = 1;
        uint256 input = base;
        uint256 exp = e;

        while (exp > 0) {
            if (exp & 1 == 1) {
                result = mulmod(result, input, m);
            }
            input = mulmod(input, input, m);
            exp >>= 1;
        }

        return result;
    }

    function _msb(uint256 x) private pure returns (uint256) {
        uint256 r = 0;
        if (x >= 2 ** 128) {
            x >>= 128;
            r += 128;
        }
        if (x >= 2 ** 64) {
            x >>= 64;
            r += 64;
        }
        if (x >= 2 ** 32) {
            x >>= 32;
            r += 32;
        }
        if (x >= 2 ** 16) {
            x >>= 16;
            r += 16;
        }
        if (x >= 2 ** 8) {
            x >>= 8;
            r += 8;
        }
        if (x >= 2 ** 4) {
            x >>= 4;
            r += 4;
        }
        if (x >= 2 ** 2) {
            x >>= 2;
            r += 2;
        }
        if (x >= 2 ** 1) {
            r += 1;
        }
        return r;
    }
}
