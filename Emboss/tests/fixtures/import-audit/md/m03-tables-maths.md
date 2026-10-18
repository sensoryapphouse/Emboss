# Markdown tables and maths

| alphaH1 | alphaH2 | alphaH3 |
|:--------|:-------:|--------:|
| a1 | a2 | a3 |
| b1 | b2 | b3 |

Table with inline formatting:

| Name | Notes |
|---|---|
| **alphabold** | *alphaitalic* and `alphacode` |
| [alphalink](https://example.org/t) | H<sub>2</sub>O and x<sup>2</sup> |
| escaped \| pipe alphapipe | empty next |
| | alphaemptyfirst |

Table without outer pipes:

alphaX | alphaY
--- | ---
1 | 2

Inline maths $x^2 + y^2 = z^2$ alphainlinemath and display:

$$\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$

Also \(a_n \cos x\) and \[\sum_{n=1}^{\infty} a_n\] alphaparenmaths.

Dollar signs like $5 and $10 alphadollars are not maths.

Function: $f(x) = a_0 + \sum_{n=1}^\infty (a_n \cos \frac{n\pi x}{L})$ alphafunc
