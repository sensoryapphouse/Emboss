| Sample | Line | Kind | Construct | Gold (before) | Book (after) | Emboss before K33 |
|---|---|---|---|---|---|---|
| example-1-17 | 1 | other misplaced run | leading indentation / centring | `                 sev5ty-five` | `      sev5ty-five` | not-representable |
| example-1-17 | 2 | other misplaced run | leading indentation / centring | `                    ,title` | `                 ,title` | not-representable |
| example-1-17 | 3 | other misplaced run | leading indentation / centring | `                  ,subtitle` | `               ,subtitle` | not-representable |
| sample-1-04 | 0 | gold line too wide | before right-margin page number | `,text is r1d acr fac+ pages z         #dd-#de` | `,text is r1d acr fac+ pages z    #dd-#de` | not-representable |
| sample-1-04 | 3 | gold line too wide | before right-margin page number | `444                                a#dd-#de` | `444                             a#dd-#de` | not-representable |
| example-2-18 | 4 | gold line too wide | contents entry: gap before its page number (2.10.7a) | `#i4 ,lov+ """""""""""""""""""""""""                              #gad` | `#i4 ,lov+ """"""""""""""""""""""""" #gad` | not-representable |
| example-2-18 | 5 | gold line too wide | contents entry: gap before its page number (2.10.7a) | `  ,true ,love """""""""""""""""""""                              #gae` | `  ,true ,love """"""""""""""""""""" #gae` | not-representable |
| example-2-18 | 8 | gold line too wide | contents entry: gap before its page number (2.10.7a) | `      m9ds.' """"""""""""""""""""""                              #gaf` | `      m9ds.' """""""""""""""""""""" #gaf` | not-representable |
| example-2-18 | 10 | gold line too wide | contents entry: gap before its page number (2.10.7a) | `      ,de> & ,lov+ ,husb&.' """""""                              #gag` | `      ,de> & ,lov+ ,husb&.' """"""" #gag` | not-representable |
| example-2-18 | 12 | gold line too wide | contents entry: gap before its page number (2.10.7a) | `      n"e travell$.' """"""""""""""                              #gah` | `      n"e travell$.' """""""""""""" #gah` | not-representable |
| sample-2-10 | 24 | gold line too wide | contents entry: gap before its page number (2.10.7a) | `           ,pr9t pages #a-#ha         t#a` | `           ,pr9t pages #a-#ha        t#a` | not-representable |
| sample-2-12 | 4 | gold line too wide | leading indentation / centring | `             ,,brief ,,3t5ts          vii` | `            ,,brief ,,3t5ts          vii` | not-representable |
| sample-2-13 | 4 | gold line too wide | leading indentation / centring | `                  ,3t5ts               #b` | `                 ,3t5ts               #b` | not-representable |
| sample-2-19 | 4 | gold line too wide | leading indentation / centring | `             ,detail$ ,3t5ts          xiv` | `            ,detail$ ,3t5ts          xiv` | not-representable |
| sample-2-21-table-of-contents-volume-1 | 18 | 2→1 collapse | contents entry: gap before its page number (2.10.7a) | `    ,c>i21n,-,a ,mosaic ( ,cultures #ea` | `    ,c>i21n,-,a ,mosaic ( ,cultures  #ea` | not-representable |
| sample-2-21-table-of-contents-volume-2 | 8 | 2→1 collapse | contents entry: gap before its page number (2.10.7a) | `    ,c>i21n,-,a ,mosaic ( ,cultures #ea` | `    ,c>i21n,-,a ,mosaic ( ,cultures  #ea` | not-representable |
| example-4-10 | 3 | 2→1 collapse | column gap (table / related columns / columned list) | `,positive ,comp>ative ,sup]lative` | `,positive  ,comp>ative  ,sup]lative` | match |
| example-4-10 | 4 | 2→1 collapse | table separation line | `"33333333 "3333333333 "3333333333` | `"33333333  "3333333333  "3333333333` | match |
| example-4-10 | 5 | 2→1 collapse | column gap after guide dots | `well """" bett] """"" be/` | `well """"  bett] """""  be/` | match |
| example-4-10 | 6 | 2→1 collapse | column gap after guide dots | `badly """ worse """"" wor/` | `badly """  worse """""  wor/` | match |
| example-4-10 | 7 | 2→1 collapse | column gap after guide dots | `ll """""" less """""" l1/` | `ll """"""  less """"""  l1/` | match |
| example-4-10 | 8 | 2→1 collapse | column gap after guide dots | `m* """""" m """"""""" mo/` | `m* """"""  m """""""""  mo/` | match |
| example-4-10 | 9 | 2→1 collapse | column gap after guide dots | `f> """""" f>!r """""" f>!/` | `f> """"""  f>!r """"""  f>!/` | match |
| example-4-11 | 4 | 2→1 collapse | column gap (table / related columns / columned list) | `2come br1k *oose draw` | `2come  br1k  *oose  draw` | mismatch |
| example-4-11 | 6 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `bet    bur/ cut     drive` | `bet    bur/  cut    drive` | mismatch |
| example-4-5 | 0 | gold line too wide | before right-margin page number | `#e4 ,am;g ! museum's o!r            c#adg` | `#e4 ,am;g ! museum's o!r           c#adg` | not-representable |
| sample-4-01 | 25 | gold line too wide | before right-margin page number | `      ,r1l-,_w ,r1d+ ,l9k          a#ajhd` | `      ,r1l-,_w ,r1d+ ,l9k         a#ajhd` | mismatch |
| sample-5-03 | 0 | gold line too wide | leading indentation / centring | `       @.<,symbols us$ 2l3            #,-` | `      @.<,symbols us$ 2l3            #,-` | mismatch |
| sample-6-13 | 7-14 | content + spacing | table separation line; column gap after guide dots | `                       #ahgj #aibj / ,miscellane\s #aj4d #aa4d / ,trade #f4h    #g4c / ,pr(es.nal1 ,cl]ical1 /   ,public ,s]vice #c4g    #ad4a / ,manufactur+_/ /   ,transporta;n #bf4a #dj4b / ,agriculture #ec4j #bg4j` | `                       #ahgj  #aibj /                        "3333  "3333 / ,miscellane\s """""""  #aj4d  #aa4d / ,trade """"""""""""""  #f4h   #g4c / ,pr(es.nal1 ,cl]ical1 /   ,public ,s]vice """  #c4g   #ad4a / ,manufactur+_/ /   ,transporta;n """""  #bf4a  #dj4b / ,agriculture """"""""  #ec4j  #bg4j` | mismatch |
| sample-6-14 | 0 | gold line too wide | before right-margin page number | `    ,critical ,?9k+                  b#ig` | `    ,critical ,?9k+                 b#ig` | mismatch |
| sample-6-14 | 24 | gold line too wide | before right-margin page number | `  444                                 #,-` | `  444                                #,-` | mismatch |
| sample-6-14 | 25 | gold line too wide | before right-margin page number | `    @.<,sec;n #c@.>                        c#ig` | `    @.<,sec;n #c@.>                 c#ig` | mismatch |
| sample-6-15 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `back =w>d home reload /op pr9t` | `back  =w>d  home  reload  /op  pr9t` | mismatch |
| sample-6-15 | 25 | 2→1 collapse | column gap (table / related columns / columned list) | `back =w>d home reload /op pr9t` | `back  =w>d  home  reload  /op  pr9t` | mismatch |
| sample-6-16 | 25 | gold line too wide | before right-margin page number | `      @.<,note@.> ,text to spee*      a#d` | `      @.<,note@.> ,text to spee*     a#d` | mismatch |
| sample-6-3 | 0 | other misplaced run | leading indentation / centring | `      ,five ,wi%es ,wallet ,c>d` | `       ,five ,wi%es ,wallet ,c>d` | mismatch |
| example-7-2 | 5 | 2→1 collapse | table separation line | `"333333333333 "333333333333` | `"333333333333  "333333333333` | match |
| example-7-2 | 6 | 2→1 collapse | column gap (table / related columns / columned list) | `is "<pres5t"> >e "<pres5t">` | `is "<pres5t">  >e "<pres5t">` | match |
| example-7-2 | 7 | 2→1 collapse | column gap after guide dots | `0 "<pa/"> """ 7 "<pa/">` | `0 "<pa/"> """  7 "<pa/">` | match |
| sample-7-01 | 1 | 2→1 collapse | column gap (table / related columns / columned list) | `,pot5tial ,5]gy ,example` | `,pot5tial ,5]gy  ,example` | not-representable |
| sample-7-01 | 2 | 2→1 collapse | table separation line | `"33333333333333 "3333333333333` | `"33333333333333  "3333333333333` | not-representable |
| sample-7-01 | 3 | 2→1 collapse | column gap after guide dots | `,*emical """""" batt]y` | `,*emical """"""  batt]y` | not-representable |
| sample-7-01 | 4 | 2→1 collapse | column gap after guide dots | `,ela/ic """"""" compress$ spr+` | `,ela/ic """""""  compress$ spr+` | not-representable |
| sample-7-01 | 5 | 2→1 collapse | column gap after guide dots | `,me*anical """" rock on a l$ge` | `,me*anical """"  rock on a l$ge` | not-representable |
| sample-7-01 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `,k9etic ,5]gy ,example` | `,k9etic ,5]gy  ,example` | not-representable |
| sample-7-01 | 10 | 2→1 collapse | table separation line | `"333333333333 "333333333333333333333333` | `"333333333333  "333333333333333333333333` | not-representable |
| sample-7-01 | 11 | 2→1 collapse | column gap after guide dots | `,s.d """""""" vibrat+ object` | `,s.d """"""""  vibrat+ object` | not-representable |
| sample-7-01 | 12 | 2→1 collapse | column gap after guide dots | `,!rmal """""" hot cocoa` | `,!rmal """"""  hot cocoa` | not-representable |
| sample-7-01 | 13 | 2→1 collapse | column gap after guide dots | `,me*anical "" fall+ rock` | `,me*anical ""  fall+ rock` | not-representable |
| sample-7-02 | 4 | 2→1 collapse | column gap (table / related columns / columned list) | `#a4 >my an ^1>my tra9$ = battle` | `#a4 >my  an ^1>my tra9$ = battle` | not-representable |
| sample-7-02 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `#b4 />ve ^1/>ve )\t food to eat` | `#b4 />ve  ^1/>ve )\t food to eat` | not-representable |
| sample-7-02 | 6 | 2→1 collapse | column gap (table / related columns / columned list) | `#c4 sc> a ^1sc> on 8 >m f a burn` | `#c4 sc>  a ^1sc> on 8 >m f a burn` | not-representable |
| sample-7-02 | 7 | 2→1 collapse | column gap (table / related columns / columned list) | `#d4 g>bage put ^1g>bage 9 ! tra% c` | `#d4 g>bage  put ^1g>bage 9 ! tra% c` | not-representable |
| sample-7-02 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `#e4 hamburg] ate a ^1hamburg] ) catsup` | `#e4 hamburg]  ate a ^1hamburg] ) catsup` | not-representable |
| sample-7-02 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `#f4 return 2f y ^1return home` | `#f4 return  2f y ^1return home` | not-representable |
| sample-7-02 | 10 | 2→1 collapse | column gap (table / related columns / columned list) | `#g4 purpose ! ^1purpose ( ! lesson` | `#g4 purpose  ! ^1purpose ( ! lesson` | not-representable |
| sample-7-02 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `#h4 surface pa9t$ ! ^1surface ( ! table` | `#h4 surface  pa9t$ ! ^1surface ( ! table` | not-representable |
| sample-7-02 | 12 | 2→1 collapse | column gap (table / related columns / columned list) | `#i4 c\rage h ^1c\rage to face dang]` | `#i4 c\rage  h ^1c\rage to face dang]` | not-representable |
| sample-7-02 | 13 | 2→1 collapse | column gap (table / related columns / columned list) | `#aj4 j\rnal a ^1j\rnal 5try ab a vaca;n` | `#aj4 j\rnal  a ^1j\rnal 5try ab a vaca;n` | not-representable |
| sample-7-02 | 17 | 2→1 collapse | column gap (table / related columns / columned list) | `#aa4 >gue ^1>gue ab : t1m is bett]` | `#aa4 >gue  ^1>gue ab : t1m is bett]` | not-representable |
| sample-7-02 | 19 | 2→1 collapse | column gap (table / related columns / columned list) | `#bj4 j\rney a ^1j\rney f ,africa to` | `#bj4 j\rney  a ^1j\rney f ,africa to` | not-representable |
| sample-7-03 | 7 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `,rank ,/ate          ,popula;n` | `,rank  ,/ate         ,popula;n` | mismatch |
| sample-7-03 | 8 | 2→1 collapse | table separation line | `"3333 "33333333333 "3333333333` | `"3333  "33333333333  "3333333333` | mismatch |
| sample-7-03 | 9 | 2→1 collapse | column gap after guide dots | `#a "" ,cali=nia "" #cf1deg1edi` | `#a ""  ,cali=nia ""  #cf1deg1edi` | mismatch |
| sample-7-03 | 10 | 2→1 collapse | column gap after guide dots | `#b "" ,texas """"" #bc1ejg1ghc` | `#b ""  ,texas """""  #bc1ejg1ghc` | mismatch |
| sample-7-03 | 11 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `#c "" ,new ,york     #ai1cjf1ahc` | `#c ""  ,new ,york    #ai1cjf1ahc` | mismatch |
| sample-7-03 | 12 | 2→1 collapse | column gap after guide dots | `#d "" ,florida """ #ah1jhi1hhh` | `#d ""  ,florida """  #ah1jhi1hhh` | mismatch |
| sample-7-03 | 13 | 2→1 collapse | column gap after guide dots | `#e "" ,ill9ois """ #ab1hca1igj` | `#e ""  ,ill9ois """  #ab1hca1igj` | mismatch |
| sample-7-03 | 14 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `#f "" ,p5nsylvania #ab1ddj1fba` | `#f ""  ,p5nsylvania  #ab1ddj1fba` | mismatch |
| sample-7-03 | 15 | 2→1 collapse | column gap after guide dots | `#g "" ,ohio """""" #aa1dgh1jjf` | `#g ""  ,ohio """"""  #aa1dgh1jjf` | mismatch |
| sample-7-03 | 16 | 2→1 collapse | column gap after guide dots | `#h "" ,mi*igan """ #aj1jie1fdc` | `#h ""  ,mi*igan """  #aj1jie1fdc` | mismatch |
| sample-7-03 | 17 | 2→1 collapse | column gap after guide dots | `#i "" ,georgia """ #i1cfc1ida` | `#i ""  ,georgia """  #i1cfc1ida` | mismatch |
| example-8-5b | 0 | gold line too wide | before right-margin page number | `text 5ds4                                             #f` | `text 5ds4                             #f` | mismatch |
| sample-8-05 | 4 | 2→1 collapse | column gap (table / related columns / columned list) | `,briti% ,columbia ,quebec` | `,briti% ,columbia  ,quebec` | mismatch |
| sample-8-07 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `prep>a;n     r1sonable rejec;n` | `prep>a;n     r1sonable  rejec;n` | mismatch |
| sample-8-07 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `responsible rev]sible selec;n` | `responsible  rev]sible  selec;n` | mismatch |
| sample-8-08 | 0 | other misplaced run | column gap (table / related columns / columned list) | `a lot              especially          \tside     #,-` | `a lot      especially  \tside        #,-` | mismatch |
| sample-8-08 | 1 | gold line too wide | column gap (table / related columns / columned list) | `ag                 "eybody             piece` | `ag         "eybody     piece` | mismatch |
| sample-8-08 | 2 | gold line too wide | column gap (table / related columns / columned list) | `alw                "ey"o               pr9ciple` | `alw        "ey"o       pr9ciple` | mismatch |
| sample-8-08 | 3 | gold line too wide | column gap (table / related columns / columned list) | `&                  "ey?+               probably` | `&          "ey?+       probably` | mismatch |
| sample-8-08 | 4 | gold line too wide | column gap (table / related columns / columned list) | `ano!r              except              r1lly` | `ano!r      except      r1lly` | mismatch |
| sample-8-08 | 5 | gold line too wide | column gap (table / related columns / columned list) | `b1uti;l            excit$              sd` | `b1uti;l    excit$      sd` | mismatch |
| sample-8-08 | 6 | gold line too wide | column gap (table / related columns / columned list) | `2c                 favorite            s*ool` | `2c         favorite    s*ool` | mismatch |
| sample-8-08 | 7 | gold line too wide | column gap (table / related columns / columned list) | `2f                 f9ally              "s?+` | `2f         f9ally      "s?+` | mismatch |
| sample-8-08 | 8 | gold line too wide | column gap (table / related columns / columned list) | `2lieve             fr                  "s"ts` | `2lieve     fr          "s"ts` | mismatch |
| sample-8-08 | 9 | gold line too wide | column gap (table / related columns / columned list) | `buy                frs                 /a;n]y` | `buy        frs         /a;n]y` | mismatch |
| sample-8-08 | 10 | gold line too wide | column gap (table / related columns / columned list) | `cau<t              fur!r               /opp$` | `cau<t      fur!r       /opp$` | mismatch |
| sample-8-08 | 11 | gold line too wide | column gap (table / related columns / columned list) | `"*                 gett+               t's` | `"*         gett+       t's` | mismatch |
| sample-8-08 | 12 | gold line too wide | column gap (table / related columns / columned list) | `,*ri/mas           ,hall[e5            _!` | `,*ri/mas   ,hall[e5    _!` | mismatch |
| sample-8-08 | 13 | gold line too wide | column gap (table / related columns / columned list) | `clo!s              happ5$              !n` | `clo!s      happ5$      !n` | mismatch |
| sample-8-08 | 14 | gold line too wide | column gap (table / related columns / columned list) | `comple;t           he>d                "!` | `comple;t   he>d        "!` | mismatch |
| sample-8-08 | 15 | gold line too wide | column gap (table / related columns / columned list) | `3sci\s             9to                 "!'s` | `3sci\s     9to         "!'s` | mismatch |
| sample-8-08 | 16 | gold line too wide | column gap (table / related columns / columned list) | `,dad's             x's                 !y` | `,dad's     x's         !y` | mismatch |
| sample-8-08 | 17 | gold line too wide | column gap (table / related columns / columned list) | `decid$             knew                !y're` | `decid$     knew        !y're` | mismatch |
| sample-8-08 | 18 | gold line too wide | column gap (table / related columns / columned list) | `def9itely          "k                  ?"\` | `def9itely  "k          ?"\` | mismatch |
| sample-8-08 | 19 | gold line too wide | column gap (table / related columns / columned list) | `didn't             let's               "?` | `didn't     let's       "?` | mismatch |
| sample-8-08 | 20 | gold line too wide | column gap (table / related columns / columned list) | `di6]5t             maybe               too` | `di6]5t     maybe       too` | mismatch |
| sample-8-08 | 21 | gold line too wide | column gap (table / related columns / columned list) | `4crete             ,mom                tri$` | `4crete     ,mom        tri$` | mismatch |
| sample-8-08 | 22 | gold line too wide | column gap (table / related columns / columned list) | `doesn't            (f                  until` | `doesn't    (f          until` | mismatch |
| sample-8-08 | 23 | gold line too wide | column gap (table / related columns / columned list) | `don't              "o                  ^u` | `don't      "o          ^u` | mismatch |
| sample-8-08 | 24 | other misplaced run | column gap (table / related columns / columned list) | `elude              \r                  usually    #,-` | `elude      \r          usually       #,-` | mismatch |
| sample-8-08 | 25 | gold line too wide | column gap (table / related columns / columned list) | `want         :5    :ole                           a#,-` | `want   :5  :ole                     a#,-` | mismatch |
| sample-8-08 | 26 | other misplaced run | column gap (table / related columns / columned list) | `we're        ":    y're` | `we're  ":  y're` | mismatch |
| sample-8-08 | 27 | other misplaced run | column gap (table / related columns / columned list) | `w5t          :     yr` | `w5t    :   yr` | mismatch |
| sample-8-17 | 0 | gold line too wide | before right-margin page number | `,room #beg                            #hi` | `,room #beg                           #hi` | not-representable |
| sample-9-03 | 3 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `mailbox ne>by     9to` | `mailbox  ne>by    9to` | mismatch |
| sample-9-03 | 4 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `"s"ts     sunrise any?+` | `"s"ts    sunrise  any?+` | mismatch |
| sample-9-04 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `,big ,bi7] ,bi7e/` | `,big  ,bi7]  ,bi7e/` | not-representable |
| sample-9-04 | 12 | 2→1 collapse | table separation line | `"333 "3333 "33333` | `"333  "3333  "33333` | not-representable |
| sample-9-04 | 13 | 2→1 collapse | column gap after guide dots | `.-    .- "" .-` | `.-    .- ""  .-` | not-representable |
| sample-9-04 | 14 | 2→1 collapse | column gap after guide dots | `.-    .- "" .-` | `.-    .- ""  .-` | not-representable |
| sample-9-08 | 0 | gold line too wide | before right-margin page number | `          ,am]ica1 ! ,b1uti;l        #fij` | `          ,am]ica1 ! ,b1uti;l       #fij` | not-representable |
| BANA Sample 10-10 | 3 | 2→1 collapse | table separation line | `"3333333 "33333333333` | `"3333333  "33333333333` | match |
| BANA Sample 10-10 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `,k5tucky ,columbus` | `,k5tucky  ,columbus` | match |
| BANA Sample 10-10 | 6 | 2→1 collapse | column gap (table / related columns / columned list) | `,florida ,frank=t` | `,florida  ,frank=t` | match |
| example-11-2 | 3 | 2→1 collapse | table separation line | `"3333333 "33333333333333333` | `"3333333  "33333333333333333` | match |
| example-11-2 | 4 | 2→1 collapse | column gap (table / related columns / columned list) | `mosquito #cj "ds` | `mosquito  #cj "ds` | match |
| example-11-2 | 6 | 2→1 collapse | column gap (table / related columns / columned list) | `elephant #fe ye>s` | `elephant  #fe ye>s` | match |
| example-11-3 | 2 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `,9f9itive ,pa/     ,pa/ ,"piciple` | `,9f9itive  ,pa/    ,pa/ ,"piciple` | mismatch |
| example-11-3 | 3 | 2→1 collapse | table separation line | `"33333333 "33333 "3333333333333` | `"33333333  "33333  "3333333333333` | mismatch |
| example-11-3 | 4 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `awake """ awoke    awok5` | `awake """  awoke   awok5` | mismatch |
| example-11-3 | 5 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `2 """"""" was1 7 be5` | `2 """""""  was1 7  be5` | mismatch |
| example-11-3 | 6 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `be> """"" bore     born` | `be> """""  bore    born` | mismatch |
| example-11-3 | 7 | 2→1 collapse | column gap after guide dots | `b1t """"" b1t "" b1t` | `b1t """""  b1t ""  b1t` | mismatch |
| example-11-3 | 8 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `2come """ 2came    2come` | `2come """  2came   2come` | mismatch |
| example-11-3 | 9 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `2g9 """"" 2gan     2gun` | `2g9 """""  2gan    2gun` | mismatch |
| example-11-3 | 10 | 2→1 collapse | column gap after guide dots | `b5d """"" b5t "" b5t` | `b5d """""  b5t ""  b5t` | mismatch |
| example-11-5 | 1 | gold line too wide | before right-margin page number | `          ,table #i4e "<3t4">                           #de` | `          ,table #i4e "<3t4">        #de` | mismatch |
| example-11-6 | 2 | 2→1 collapse | column gap (table / related columns / columned list) | `               ,habitat ,pot5tial` | `               ,habitat  ,pot5tial` | mismatch |
| example-11-6 | 4 | 2→1 collapse | table separation line | `"333333333333 "3333333 "333333333` | `"333333333333  "3333333  "333333333` | mismatch |
| example-11-6 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `,grizzly ,be> ,v>iable ,undet]m9$` | `,grizzly ,be>  ,v>iable  ,undet]m9$` | mismatch |
| example-11-8 | 5 | 2→1 collapse | column gap after guide dots | `,/ove """" ,model #cd"dcb"efg` | `,/ove """"  ,model #cd"dcb"efg` | mismatch |
| example-11-8 | 6 | 2→1 collapse | column gap (table / related columns / columned list) | `,microwave ,model #hg"ijh"eca` | `,microwave  ,model #hg"ijh"eca` | mismatch |
| example-11-9 | 8 | 2→1 collapse | table separation line | `     "3333 "3333 "3333 "3333 "33333` | `     "3333  "3333  "3333  "3333  "33333` | mismatch |
| example-11-9 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `##a hgaga dcjfb cigac ajjbd cbgb` | `##a  hgaga  dcjfb  cigac  ajjbd  cbgb` | mismatch |
| example-11-9 | 10 | 2→1 collapse | column gap (table / related columns / columned list) | `b    bhijc ejhef cjedi hiahg afgd` | `b    bhijc  ejhef  cjedi  hiahg  afgd` | mismatch |
| example-11-9 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `c    hfbdd gaaea eejcf acjdd ccaf#'` | `c    hfbdd  gaaea  eejcf  acjdd  ccaf#'` | mismatch |
| sample-11-01 | 3 | 2→1 collapse | column gap (table / related columns / columned list) | `#e4be.01 comp.d$ ,,apy` | `#e4be.01 comp.d$  ,,apy` | mismatch |
| sample-11-01 | 4 | 2→1 collapse | table separation line | `"333333333333333 "333333` | `"333333333333333  "333333` | mismatch |
| sample-11-01 | 5 | 2→1 collapse | column gap after guide dots | `,daily """"""""" #e4ci.0` | `,daily """""""""  #e4ci.0` | mismatch |
| sample-11-01 | 6 | 2→1 collapse | column gap after guide dots | `,qu>t]ly """"""" #e4ce.0` | `,qu>t]ly """""""  #e4ce.0` | mismatch |
| sample-11-01 | 7 | 2→1 collapse | column gap after guide dots | `,semiannually "" #e4cb.0` | `,semiannually ""  #e4cb.0` | mismatch |
| sample-11-01 | 8 | 2→1 collapse | column gap after guide dots | `,annually """""" #e4be.0` | `,annually """"""  #e4be.0` | mismatch |
| sample-11-02 | 10 | 2→1 collapse | table separation line | `"333333 "333333333 "3333333 "3333333` | `"333333  "333333333  "3333333  "3333333` | match |
| sample-11-02 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `#aiih      #iha1gab #hag1ggj #afc1idb` | `#aiih      #iha1gab  #hag1ggj  #afc1idb` | match |
| sample-11-02 | 12 | 2→1 collapse | column gap (table / related columns / columned list) | `#aiii    #a1jja1fgf #hbe1hcc #age1hdc` | `#aiii    #a1jja1fgf  #hbe1hcc  #age1hdc` | match |
| sample-11-02 | 13 | 2→1 collapse | column gap (table / related columns / columned list) | `#bjjj    #a1jed1ejc #hfg1gac #ahf1gij` | `#bjjj    #a1jed1ejc  #hfg1gac  #ahf1gij` | match |
| sample-11-02 | 14 | 2→1 collapse | column gap (table / related columns / columned list) | `#bjja    #a1abh1dcb #ibj1cid #bjh1jch` | `#bjja    #a1abh1dcb  #ibj1cid  #bjh1jch` | match |
| sample-11-03 | 4 | 2→1 collapse | table separation line | `"333333333333333333333 "33333 "33333` | `"333333333333333333333  "33333  "33333` | mismatch |
| sample-11-03 | 6 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `  ,produc;n """""""""" #dac4j #dhb4f` | `  ,produc;n """"""""""  #dac4j  #dhb4f` | mismatch |
| sample-11-03 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `  ,imports """""""""""   #ic4d #aie4g` | `  ,imports """""""""""   #ic4d  #aie4g` | mismatch |
| sample-11-03 | 10 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `  ,produc;n """""""""" #aaj4f    #ig4a` | `  ,produc;n """"""""""  #aaj4f   #ig4a` | mismatch |
| sample-11-04 | 10 | 2→1 collapse | table separation line | `"333333333333 "333333333333 "333333333` | `"333333333333  "333333333333  "333333333` | mismatch |
| sample-11-04 | 11 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,grizzly ,be> ,v>iable """" ,undet]m9$` | `,grizzly ,be>  ,v>iable """"  ,undet]m9$` | mismatch |
| sample-11-04 | 17 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `,pika """"""" #a ac_/         #ec1jjj` | `,pika """""""  #a ac_/        #ec1jjj` | mismatch |
| sample-11-05 | 3 | 2→1 collapse | column gap after guide dots | `,g5d] "" ,male """" #bb.0` | `,g5d] ""  ,male """"  #bb.0` | mismatch |
| sample-11-05 | 4 | 2→1 collapse | column gap after guide dots | `          ,female "" #gh.0` | `          ,female ""  #gh.0` | mismatch |
| sample-11-05 | 5 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,e?nic;y ,:ite """" #hi.0` | `,e?nic;y  ,:ite """"  #hi.0` | mismatch |
| sample-11-05 | 6 | 2→1 collapse | column gap after guide dots | `          ,asian """ #e.0` | `          ,asian """  #e.0` | mismatch |
| sample-11-05 | 7 | 2→1 collapse | column gap after guide dots | `          ,black """ #c.0` | `          ,black """  #c.0` | mismatch |
| sample-11-05 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `          ,mix$_/o!r #c.0` | `          ,mix$_/o!r  #c.0` | mismatch |
| sample-11-05 | 9 | 2→1 collapse | column gap after guide dots | `,age """ #af-#bd "" #g.0` | `,age """  #af-#bd ""  #g.0` | mismatch |
| sample-11-05 | 10 | 2→1 collapse | column gap after guide dots | `          #be-#cd "" #bc.0` | `          #be-#cd ""  #bc.0` | mismatch |
| sample-11-05 | 11 | 2→1 collapse | column gap after guide dots | `          #ce-#dd "" #bi.0` | `          #ce-#dd ""  #bi.0` | mismatch |
| sample-11-05 | 12 | 2→1 collapse | column gap after guide dots | `          #de-#ed "" #be.0` | `          #de-#ed ""  #be.0` | mismatch |
| sample-11-05 | 13 | 2→1 collapse | column gap after guide dots | `          #ee-#fd "" #ad.0` | `          #ee-#fd ""  #ad.0` | mismatch |
| sample-11-05 | 14 | 2→1 collapse | column gap after guide dots | `          #fe"6 """" #a.0` | `          #fe"6 """"  #a.0` | mismatch |
| sample-11-06 | 9 | 2→1 collapse | table separation line | `"333333333333333333 "3333 "3333` | `"333333333333333333  "3333  "3333` | mismatch |
| sample-11-06 | 10 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `,nor? ,ea/ """""""" #e.0    #ie.0` | `,nor? ,ea/ """"""""  #e.0   #ie.0` | mismatch |
| sample-11-06 | 11 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `,nor? ,we/ """""""" #h.0    #ib.0` | `,nor? ,we/ """"""""  #h.0   #ib.0` | mismatch |
| sample-11-06 | 12 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,ea/ ( ,5gl& """""" #ad.0 #hf.0` | `,ea/ ( ,5gl& """"""  #ad.0  #hf.0` | mismatch |
| sample-11-06 | 13 | 2→1 collapse | column gap (table / related columns / columned list) | `,york%ire @& ,humb] #bc.0 #gg.0` | `,york%ire @& ,humb]  #bc.0  #gg.0` | mismatch |
| sample-11-06 | 14 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,s\? ,ea/ """"""""" #bh.0 #gb.0` | `,s\? ,ea/ """""""""  #bh.0  #gb.0` | mismatch |
| sample-11-06 | 15 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,s\? ,we/ """"""""" #cb.0 #fh.0` | `,s\? ,we/ """""""""  #cb.0  #fh.0` | mismatch |
| sample-11-06 | 16 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,ea/ ,midl&s """""" #db.0 #eh.0` | `,ea/ ,midl&s """"""  #db.0  #eh.0` | mismatch |
| sample-11-06 | 17 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,london """"""""""" #de.0 #ee.0` | `,london """""""""""  #de.0  #ee.0` | mismatch |
| sample-11-06 | 18 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,we/ ,midl&s """""" #ej.0 #ej.0` | `,we/ ,midl&s """"""  #ej.0  #ej.0` | mismatch |
| sample-11-06 | 20 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,5gl& """"""""""""" #cj.0 #gj.0` | `,5gl& """""""""""""  #cj.0  #gj.0` | mismatch |
| sample-11-06 | 21 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `,nor!rn ,irel& """" #d.0    #if.0` | `,nor!rn ,irel& """"  #d.0   #if.0` | mismatch |
| sample-11-06 | 22 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,scotl& """"""""""" #ca.0 #fi.0` | `,scotl& """""""""""  #ca.0  #fi.0` | mismatch |
| sample-11-06 | 23 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,wales """""""""""" #df.0 #ed.0` | `,wales """"""""""""  #df.0  #ed.0` | mismatch |
| sample-11-06 | 25 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,,uk """""""""""""" #ca.0 #fi.0` | `,,uk """"""""""""""  #ca.0  #fi.0` | mismatch |
| sample-11-07 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `,animals ,groom+ ,juv5ile ,9fant` | `,animals ,groom+  ,juv5ile  ,9fant` | match |
| sample-11-07 | 6 | 2→1 collapse | table separation line | `"333333333333333 "3333333 "33333` | `"333333333333333  "3333333  "33333` | match |
| sample-11-07 | 7 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,silv]back$ male #j """"" #c` | `,silv]back$ male  #j """""  #c` | match |
| sample-11-07 | 8 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,blackback$ male #j """"" #j` | `,blackback$ male  #j """""  #j` | match |
| sample-11-08 | 4 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `,pr(it """""""""""" @s# c4ej    #aj.0` | `,pr(it """"""""""""  @s# c4ej   #aj.0` | mismatch |
| sample-11-08 | 8 | 2→1 collapse | table separation line | `                     "3333333 "33333` | `                     "3333333  "33333` | mismatch |
| sample-11-08 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `,cu/om]'s ,m1l ,co/ @s#ce4jj #ajj.0` | `,cu/om]'s ,m1l ,co/  @s#ce4jj  #ajj.0` | mismatch |
| sample-11-09 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `,ye>   #ast half #bnd half ,annual avg` | `,ye>   #ast half  #bnd half  ,annual avg` | mismatch |
| sample-11-09 | 9 | 2→1 collapse | table separation line | `"3333 "33333333 "33333333 "3333333333` | `"3333  "33333333  "33333333  "3333333333` | mismatch |
| sample-11-09 | 10 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `#aihj ,- """""" ,- """"""      #hb4i` | `#aihj  ,- """"""  ,- """"""   #hb4i` | mismatch |
| sample-11-09 | 11 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `#aiha ,- """""" ,- """"""      #ia4d` | `#aiha  ,- """"""  ,- """"""   #ia4d` | mismatch |
| sample-11-09 | 12 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `#aihb ,- """""" ,- """"""      #if4i` | `#aihb  ,- """"""  ,- """"""   #if4i` | mismatch |
| sample-11-09 | 13 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `#aihc ,- """""" ,- """"""      #ii4h` | `#aihc  ,- """"""  ,- """"""   #ii4h` | mismatch |
| sample-11-09 | 14 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `#aihd #ajb4a "" #ajd4d "" #ajc4c` | `#aihd  #ajb4a ""  #ajd4d ""  #ajc4c` | mismatch |
| sample-11-10 | 7 | 2→1 collapse | table separation line | `"3333333 "333333333333333333333` | `"3333333  "333333333333333333333` | mismatch |
| sample-11-10 | 10 | 2→1 collapse | column gap before a guide-dotted (blank) entry | `,w$nes"d """"""""""""""""""""""` | `,w$nes"d  """"""""""""""""""""""` | mismatch |
| sample-11-11 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `              #aihf #aihg #aihh #aihi` | `              #aihf  #aihg  #aihh  #aihi` | mismatch |
| sample-11-11 | 12 | 2→1 collapse | table separation line | `              "3333 "3333 "3333 "3333` | `              "3333  "3333  "3333  "3333` | mismatch |
| sample-11-11 | 13 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,m>ijuana "" #he4b #hd4h #he4j #hd4c` | `,m>ijuana ""  #he4b  #hd4h  #he4j  #hd4c` | mismatch |
| sample-11-11 | 15 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `  nitrites    """"" #bc4i #be4i #bf4h` | `  nitrites    """""  #bc4i  #be4i  #bf4h` | mismatch |
| sample-11-11 | 16 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,,lsd """""" #bh4e #ca4d #cc4c #ch4c` | `,,lsd """"""  #bh4e  #ca4d  #cc4c  #ch4c` | mismatch |
| sample-11-11 | 18 | 2→1 collapse | column gap (table / related columns / columned list) | `  halluc9og5 #bd4i #be4j #bf4b #bh4b` | `  halluc9og5  #bd4i  #be4j  #bf4b  #bh4b` | mismatch |
| sample-11-11 | 19 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,,pcp """""" """"" #bb4h #bd4i #bh4i` | `,,pcp """"""  """""  #bb4h  #bd4i  #bh4i` | mismatch |
| sample-11-11 | 21 | 2→1 collapse | column gap after guide dots; column gap before a guide-dotted (blank) entry | `  "<,,mdma"> """"" """"" """"" #ba4g` | `  "<,,mdma">  """""  """""  """""  #ba4g` | mismatch |
| sample-11-12 | 3 | 2→1 collapse | column gap (table / related columns / columned list) | `,price ,surplus_/,%ortage ,price ,w` | `,price  ,surplus_/,%ortage  ,price ,w` | mismatch |
| sample-11-12 | 4 | 2→1 collapse | table separation line | `"33333 "33333333333333333 "33333333` | `"33333  "33333333333333333  "33333333` | mismatch |
| sample-11-12 | 5 | 2→1 collapse | column gap after guide dots | `#a4jj   ,surplus """"""""" ,fall` | `#a4jj   ,surplus """""""""  ,fall` | mismatch |
| sample-11-12 | 6 | 2→1 collapse | column gap after guide dots | `#j4ij   "1 """"""""""""""" "1` | `#j4ij   "1 """""""""""""""  "1` | mismatch |
| sample-11-12 | 7 | 2→1 collapse | column gap after guide dots | `#j4hj   "1 """"""""""""""" "1` | `#j4hj   "1 """""""""""""""  "1` | mismatch |
| sample-11-12 | 8 | 2→1 collapse | column gap after guide dots | `#j4gj   ,nei """"""""""""" ,nei` | `#j4gj   ,nei """""""""""""  ,nei` | mismatch |
| sample-11-12 | 9 | 2→1 collapse | column gap after guide dots | `#j4fj   ,%ortage """"""""" ,rise` | `#j4fj   ,%ortage """""""""  ,rise` | mismatch |
| sample-11-12 | 10 | 2→1 collapse | column gap after guide dots | `#j4ej   "1 """"""""""""""" "1` | `#j4ej   "1 """""""""""""""  "1` | mismatch |
| sample-11-12 | 11 | 2→1 collapse | column gap after guide dots | `#j4dj   "1 """"""""""""""" "1` | `#j4dj   "1 """""""""""""""  "1` | mismatch |
| sample-11-13 | 3 | other misplaced run | leading indentation / centring | `     article d=fini` | `      article d=fini` | mismatch |
| sample-11-13 | 4 | other misplaced run | leading indentation / centring | `     "3333333333333333333333333333333` | `      "3333333333333333333333333333333` | mismatch |
| sample-11-13 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `pr=p masc sg masc pl f=m sg f=m pl` | `pr=p  masc sg  masc pl  f=m sg  f=m pl` | mismatch |
| sample-11-13 | 6 | 2→1 collapse | table separation line | `"333 "333333 "333333 "33333 "33333` | `"333  "333333  "333333  "33333  "33333` | mismatch |
| sample-11-13 | 7 | 2→1 collapse | column gap after guide dots | `a "" ao """" dos """ ( """" (s` | `a ""  ao """"  dos """  ( """"  (s` | mismatch |
| sample-11-13 | 8 | 2→1 collapse | column gap after guide dots | `de    do """" dos """ da """ das` | `de    do """"  dos """  da """  das` | mismatch |
| sample-11-13 | 9 | 2→1 collapse | column gap after guide dots | `em    no """" nos """ na """ nos` | `em    no """"  nos """  na """  nos` | mismatch |
| sample-11-13 | 10 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `por   pelo "" pelos     pela    pelas` | `por   pelo ""  pelos    pela    pelas` | mismatch |
| sample-11-14 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `                 #aiib #aiic #aiid` | `                 #aiib  #aiic  #aiid` | mismatch |
| sample-11-14 | 10 | 2→1 collapse | table separation line | `                 "3333 "3333 "3333` | `                 "3333  "3333  "3333` | mismatch |
| sample-11-14 | 12 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `  ,daily """""" #ag4b #ai4j #ai4d` | `  ,daily """"""  #ag4b  #ai4j  #ai4d` | mismatch |
| sample-11-14 | 14 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `    m p] "d """ #aj4j #aj4i #aa4b` | `    m p] "d """  #aj4j  #aj4i  #aa4b` | mismatch |
| sample-11-15 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `ye>   total    pay;ts   9ve/;t rema9d]` | `ye>   total    pay;ts   9ve/;t  rema9d]` | mismatch |
| sample-11-15 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `#aiij #ace1cbe #gg1bfd #bg1ahe #cj1hgf` | `#aiij #ace1cbe  #gg1bfd #bg1ahe #cj1hgf` | mismatch |
| sample-11-15 | 12 | 2→1 collapse | column gap (table / related columns / columned list) | `#aiia #aed1eai #ib1hfe #bh1bcg #cc1dag` | `#aiia #aed1eai  #ib1hfe #bh1bcg #cc1dag` | mismatch |
| sample-11-16 | 0 | gold line too wide | before right-margin page number | `7777777777777777777777777777777777    #,-` | `7777777777777777777777777777777777   #,-` | mismatch |
| sample-11-16 | 15 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `rec vms    mms   totals` | `rec  vms   mms   totals` | mismatch |
| sample-11-16 | 16 | 2→1 collapse | table separation line | `"33 "333 "333 "33333` | `"33  "333  "333  "33333` | mismatch |
| sample-11-16 | 17 | 2→1 collapse | column gap (table / related columns / columned list) | `nan #dhb #dha #ifc` | `nan  #dhb  #dha  #ifc` | mismatch |
| sample-11-16 | 18 | 2→1 collapse | column gap (table / related columns / columned list) | `aam #dcd #dbf #hfj` | `aam  #dcd  #dbf  #hfj` | mismatch |
| sample-11-16 | 19 | 2→1 collapse | column gap (table / related columns / columned list) | `wht #ebh #ecj #ajeh` | `wht  #ebh  #ecj  #ajeh` | mismatch |
| sample-11-17 | 6 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `,,,s*ool p    pets places books,'` | `,,,s*ool  p   pets  places  books,'` | mismatch |
| sample-11-17 | 7 | 2→1 collapse | table separation line | `"3333333 "3 "333 "33333 "333333` | `"3333333  "3  "333  "33333  "333333` | mismatch |
| sample-11-17 | 8 | 2→1 collapse | column gap after guide dots | `"""""""" "" """" """""" """""""` | `""""""""  ""  """"  """"""  """""""` | mismatch |
| sample-11-17 | 9 | 2→1 collapse | column gap after guide dots | `"""""""" "" """" """""" """""""` | `""""""""  ""  """"  """"""  """""""` | mismatch |
| sample-11-18 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `,cause           ;\o ,e6ect` | `,cause           ;\o  ,e6ect` | mismatch |
| sample-11-18 | 6 | 2→1 collapse | table separation line | `"33333333333333 "33 "333333333333333` | `"33333333333333  "33  "333333333333333` | mismatch |
| sample-11-18 | 7 | 2→1 collapse | column gap (table / related columns / columned list) | `,$ told a lie4   ;\o ,i got upset4` | `,$ told a lie4   ;\o  ,i got upset4` | mismatch |
| sample-11-18 | 8 | 2→1 collapse | column gap (table / related columns / columned list); column gap after guide dots | `,$ d5i$ x4 """" ;\o ,i got angri]4` | `,$ d5i$ x4 """"  ;\o  ,i got angri]4` | mismatch |
| sample-11-18 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `,$ 2tray$ o!rs4 ;\o ,he 5d$ up fr.s4` | `,$ 2tray$ o!rs4  ;\o  ,he 5d$ up fr.s4` | mismatch |
| sample-11-18 | 10 | 2→1 collapse | column gap after guide dots; column gap before a guide-dotted (blank) entry | `""""""""""""""" ;\o """"""""""""""""` | `"""""""""""""""  ;\o  """"""""""""""""` | mismatch |
| sample-11-18 | 11 | 2→1 collapse | column gap after guide dots; column gap before a guide-dotted (blank) entry | `""""""""""""""" ;\o """"""""""""""""` | `"""""""""""""""  ;\o  """"""""""""""""` | mismatch |
| sample-11-18 | 12 | 2→1 collapse | column gap after guide dots; column gap before a guide-dotted (blank) entry | `""""""""""""""" ;\o """"""""""""""""` | `"""""""""""""""  ;\o  """"""""""""""""` | mismatch |
| sample-11-19 | 8 | 2→1 collapse | table separation line | `      "33333333333 "3333333333` | `      "33333333333  "3333333333` | mismatch |
| sample-11-19 | 9 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `,jan #i3#dg ,,am    #d3#ce ,,pm` | `,jan  #i3#dg ,,am   #d3#ce ,,pm` | mismatch |
| sample-11-19 | 10 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `,feb #h3#bg ,,am    #f3#ja ,,pm` | `,feb  #h3#bg ,,am   #f3#ja ,,pm` | mismatch |
| sample-11-19 | 12 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `,nov #i3#ai ,,am    #d3#aj ,,pm` | `,nov  #i3#ai ,,am   #d3#aj ,,pm` | mismatch |
| sample-11-19 | 13 | 2→1 collapse | column gap (table / related columns / columned list) | `,dec #aj3#ad ,,am #c3#da ,,pm` | `,dec  #aj3#ad ,,am  #c3#da ,,pm` | mismatch |
| sample-11-20 | 0 | gold line too wide | before right-margin page number | `7777777777777777777777777777777777    #,-` | `7777777777777777777777777777777777   #,-` | mismatch |
| sample-11-20 | 11 | 2→1 collapse | table separation line | `"333333 "3333333 "3333333` | `"333333  "3333333  "3333333` | mismatch |
| sample-11-20 | 13 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `#de-#fd #beg1jjj    #hf1jjj` | `#de-#fd  #beg1jjj   #hf1jjj` | mismatch |
| sample-11-20 | 14 | 2→1 collapse | column gap (table / related columns / columned list) | `#fe"6    #dcj1jjj #cad1jjj` | `#fe"6    #dcj1jjj  #cad1jjj` | mismatch |
| sample-11-21 | 5 | 2→1 collapse | column gap (table / related columns / columned list) | `         #aijj #aiaj #aibj #aicj` | `         #aijj  #aiaj  #aibj  #aicj` | mismatch |
| sample-11-21 | 6 | 2→1 collapse | table separation line | `         "3333 "3333 "3333 "333333333` | `         "3333  "3333  "3333  "333333333` | mismatch |
| sample-11-21 | 7 | 2→1 collapse | column gap (table / related columns / columned list) | `,d5m>k   #ac4i #af4b #cg4j #cc4h """"` | `,d5m>k   #ac4i  #af4b  #cg4j  #cc4h """"` | mismatch |
| sample-11-21 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `,sw$5     #h4g #ab4b #cb4d #da4g """"` | `,sw$5     #h4g  #ab4b  #cb4d  #da4g """"` | mismatch |
| sample-11-21 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `,norway #aj4c #ad4f #ce4i #dc4b """"` | `,norway  #aj4c  #ad4f  #ce4i  #dc4b """"` | mismatch |
| sample-11-21 | 10 | 2→1 collapse | column gap (table / related columns / columned list) | `,f9l&     #f4i #aj4c #be4f #cd4g """"` | `,f9l&     #f4i  #aj4c  #be4f  #cd4g """"` | mismatch |
| sample-11-21 | 17 | 2→1 collapse | column gap (table / related columns / columned list) | `#aidj #aiej` | `#aidj  #aiej` | mismatch |
| sample-11-21 | 18 | 2→1 collapse | table separation line | `"3333 "3333` | `"3333  "3333` | mismatch |
| sample-11-21 | 19 | 2→1 collapse | column gap (table / related columns / columned list) | `#dd4c #ed4d` | `#dd4c  #ed4d` | mismatch |
| sample-11-21 | 20 | 2→1 collapse | column gap (table / related columns / columned list) | `#fd4c #ge4b` | `#fd4c  #ge4b` | mismatch |
| sample-11-21 | 21 | 2→1 collapse | column gap (table / related columns / columned list) | `#fg4i #gg4c` | `#fg4i  #gg4c` | mismatch |
| sample-11-21 | 22 | 2→1 collapse | column gap (table / related columns / columned list) | `#dd4b #eb4a` | `#dd4b  #eb4a` | mismatch |
| sample-11-22 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `         #aijj #aiaj #aibj #aicj` | `         #aijj  #aiaj  #aibj  #aicj` | match |
| sample-11-22 | 9 | 2→1 collapse | table separation line | `         "3333 "3333 "3333 "3333` | `         "3333  "3333  "3333  "3333` | match |
| sample-11-22 | 10 | 2→1 collapse | column gap (table / related columns / columned list) | `,d5m>k   #ac4i #af4b #cg4j #cc4h` | `,d5m>k   #ac4i  #af4b  #cg4j  #cc4h` | match |
| sample-11-22 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `,sw$5     #h4g #ab4b #cb4d #da4g` | `,sw$5     #h4g  #ab4b  #cb4d  #da4g` | match |
| sample-11-22 | 12 | 2→1 collapse | column gap (table / related columns / columned list) | `,norway #aj4c #ad4f #ce4i #dc4b` | `,norway  #aj4c  #ad4f  #ce4i  #dc4b` | match |
| sample-11-22 | 13 | 2→1 collapse | column gap (table / related columns / columned list) | `,f9l&     #f4i #aj4c #be4f #cd4g` | `,f9l&     #f4i  #aj4c  #be4f  #cd4g` | match |
| sample-11-22 | 15 | 2→1 collapse | column gap (table / related columns / columned list) | `         #aidj #aiej` | `         #aidj  #aiej` | match |
| sample-11-22 | 16 | 2→1 collapse | table separation line | `         "3333 "3333` | `         "3333  "3333` | match |
| sample-11-22 | 17 | 2→1 collapse | column gap (table / related columns / columned list) | `,d5m>k   #dd4c #ed4d` | `,d5m>k   #dd4c  #ed4d` | match |
| sample-11-22 | 18 | 2→1 collapse | column gap (table / related columns / columned list) | `,sw$5    #fd4c #ge4b` | `,sw$5    #fd4c  #ge4b` | match |
| sample-11-22 | 19 | 2→1 collapse | column gap (table / related columns / columned list) | `,norway #fg4i #gg4c` | `,norway  #fg4i  #gg4c` | match |
| sample-11-22 | 20 | 2→1 collapse | column gap (table / related columns / columned list) | `,f9l&    #dd4b #eb4a` | `,f9l&    #dd4b  #eb4a` | match |
| sample-11-23 | 6 | 2→1 collapse | table separation line | `      "3333333333 "3333333333` | `      "3333333333  "3333333333` | mismatch |
| sample-11-23 | 7 | 2→1 collapse | column gap (table / related columns / columned list) | `,jan #g3#bc ,,am #e3#ec ,,pm` | `,jan  #g3#bc ,,am  #e3#ec ,,pm` | mismatch |
| sample-11-23 | 8 | 2→1 collapse | column gap (table / related columns / columned list) | `,feb #g3#jb ,,am #f3#ai ,,pm` | `,feb  #g3#jb ,,am  #f3#ai ,,pm` | mismatch |
| sample-11-23 | 9 | 2→1 collapse | column gap (table / related columns / columned list) | `,m>   #f3#ca ,,am #f3#ch ,,pm` | `,m>   #f3#ca ,,am  #f3#ch ,,pm` | mismatch |
| sample-11-23 | 10 | 2→1 collapse | column gap (table / related columns / columned list) | `,apr #f3#aj ,,am #g3#eg ,,pm` | `,apr  #f3#aj ,,am  #g3#eg ,,pm` | mismatch |
| sample-11-23 | 11 | 2→1 collapse | column gap (table / related columns / columned list) | `,may #e3#ej ,,am #h3#ag ,,pm` | `,may  #e3#ej ,,am  #h3#ag ,,pm` | mismatch |
| sample-11-23 | 12 | 2→1 collapse | column gap (table / related columns / columned list) | `,jun #e3#cj ,,am #h3#ca ,,pm` | `,jun  #e3#cj ,,am  #h3#ca ,,pm` | mismatch |
| sample-11-24 | 0 | gold line too wide | before right-margin page number | `7777777777777777777777777777777777    #,-` | `7777777777777777777777777777777777   #,-` | mismatch |
| sample-11-26 | 0 | gold line too wide | before right-margin page number | `              ,vietnam ,w>           #bcc` | `              ,vietnam ,w>          #bcc` | mismatch |
| sample-12-3 | 22 | gold line too wide | before right-margin page number | `    ,applica;n ,activ;y             a#chj` | `    ,applica;n ,activ;y            a#chj` | mismatch |
| sample-12-7 | 0 | gold line too wide | before right-margin page number | `            ,use ,vocabul>y         ,c#gh` | `            ,use ,vocabul>y        ,c#gh` | mismatch |
| example-13-5 | 5 | gold line too wide | poetry stress/scansion mark positions | `   x        _/                x                _/             x` | `   x     _/     x      _/    x` | not-representable |
| example-13-5 | 8 | gold line too wide | poetry stress/scansion mark positions | `      _/         x               _/          x              _/` | `      _/   x     _/   x     _/` | not-representable |
| sample-13-09 | 12 | 2→1 collapse, compensated by +1 in a later gap/lead | poetry stress/scansion mark positions | `   ^/   @+ @+^/     @+ ^/` | `   ^/   @+  @+^/    @+  ^/` | mismatch |
| sample-13-09 | 15 | other misplaced run | poetry stress/scansion mark positions | `   @+ ^/     ^/     ^/     @+  ^/` | `   @+ ^/     ^/     ^/    @+   ^/` | mismatch |
| sample-13-10 | 12 | 2→1 collapse, compensated by +1 in a later gap/lead | poetry stress/scansion mark positions | `   @+ ^/       @+^/    @+ ^/` | `   @+  ^/      @+^/    @+  ^/` | mismatch |
| sample-13-10 | 15 | 2→1 collapse, compensated by +1 in a later gap/lead | poetry stress/scansion mark positions | `    @+ ^/      @+ ^/` | `    @+  ^/     @+ ^/` | mismatch |
| sample-13-11 | 0 | gold line too wide | before right-margin page number | `,ah1 4t9ctly ,i rememb] x 0 9 !       #,-` | `,ah1 4t9ctly ,i rememb] x 0 9 !      #,-` | mismatch |
| sample-13-12 | 20 | other misplaced run | poetry stress/scansion mark positions | `   ^/ @+     ^/   @+      ^/ @+` | `   ^/ @+     ^/   @+     ^/ @+` | mismatch |
| sample-13-12 | 25 | other misplaced run | poetry stress/scansion mark positions | `     ^/ @+     ^/     @+    ^/  @+` | `     ^/ @+     ^/    @+    ^/   @+` | mismatch |
| sample-13-12 | 30 | 2→1 collapse, compensated by +1 in a later gap/lead | poetry stress/scansion mark positions | `   ^/ @+   ^/     @+    ^/ @+` | `   ^/ @+   ^/     @+   ^/  @+` | mismatch |
| sample-13-12 | 33 | 2→1 collapse, compensated by +1 in a later gap/lead | poetry stress/scansion mark positions | `     ^/ @+     ^/    @+     ^/  @+` | `     ^/  @+    ^/   @+     ^/   @+` | mismatch |
| BANA Sample 14-11 | 8 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,woman ,my p>5ts get 9to t[n next week1` | `,woman  ,my p>5ts get 9to t[n next week1` | mismatch |
| BANA Sample 14-11 | 11 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,e?an ,sup]b4` | `,e?an  ,sup]b4` | mismatch |
| BANA Sample 14-11 | 14 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,e?an ,slipp$ my m9d4` | `,e?an  ,slipp$ my m9d4` | mismatch |
| BANA Sample 14-11 | 15 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,woman ,e?an1 come on4 ,!y're yr p>5ts4` | `,woman  ,e?an1 come on4 ,!y're yr p>5ts4` | mismatch |
| BANA Sample 14-11 | 16 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,e?an ,no6 ,!y >e sadi/ic p :o took` | `,e?an  ,no6 ,!y >e sadi/ic p :o took` | mismatch |
| BANA Sample 14-11 | 21 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,"m ,no m video games until y're d"o )` | `,"m  ,no m video games until y're d"o )` | mismatch |
| BANA Sample 14-12 | 4 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,capta9 ,ju/ice @.</&+ at ! ice` | `,capta9 ,ju/ice  @.</&+ at ! ice` | mismatch |
| BANA Sample 14-12 | 7 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,capta9 ,ju/ice @.<fly+ away@.> ,h an` | `,capta9 ,ju/ice  @.<fly+ away@.> ,h an` | mismatch |
| BANA Sample 14-5 | 3 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,craig ,yes1 ! ,delphis4` | `,craig  ,yes1 ! ,delphis4` | mismatch |
| BANA Sample 14-5 | 4 | 2→1 collapse | speaker name gap (14.10.5a / 14.11 / 14.5.2) | `,pet] ,run1 ,run4` | `,pet]  ,run1 ,run4` | mismatch |
| BANA Sample 15-3 | 12 | 2→1 collapse | before line number (15.3.1c: at least two blank cells) | `morn+1 :5 we   clos$ ! door to avoid #e` | `morn+1 :5 we   clos$ ! door to avoid  #e` | mismatch |
| BANA Sample 15-4 | 14 | 2→1 collapse | before line number (15.3.1c: at least two blank cells) | `delicately   prob+ = ,billy ,boy 9 #bbc` | `delicately   prob+ = ,billy ,boy 9  #bbc` | mismatch |
| BANA Sample 15-9 | 10 | 2→1 collapse | before line number (15.3.1c: at least two blank cells) | `8,t rat eats too   m*4 ,i m/ make ! #ac` | `8,t rat eats too   m*4 ,i m/ make !  #ac` | not-representable |
| example-16-10 | 0 | gold line too wide | before right-margin page number | `,brutus3 ,romans1 @.<note@.>                           #ad` | `,brutus3 ,romans1 @.<note@.>         #ad` | not-representable |
| example-16-10 | 2 | gold line too wide | column gap (table / related columns / columned list) | `  me = my   cause1 & 2 sil5t1 t y                      #ae` | `  me = my   cause1 & 2 sil5t1 t y    #ae` | not-representable |
| sample-16-05 | 0 | gold line too wide | before right-margin page number | `  ,8,%]idan w n su3e$ at ,ba? ) 8    a#,-` | `  ,8,%]idan w n su3e$ at ,ba? ) 8   a#,-` | mismatch |
| sample-16-07 | 0 | gold line too wide | before right-margin page number | `444 n"e 3fess$ until n[4            a#dcc` | `444 n"e 3fess$ until n[4           a#dcc` | not-representable |
| sample-16-08 | 5 | gold line too wide | before right-margin page number | `  extreme degree4 ,"!=e1 8,my                          #,-` | `  extreme degree4 ,"!=e1 8,my        #,-` | not-representable |
| sample-16-08 | 6 | gold line too wide | before right-margin page number | `  suspicions un=tunately >e                     b#ajj-#aja` | `  suspicions un=tunately >e   b#ajj-#aja` | not-representable |
| sample-16-09 | 0 | gold line too wide | before right-margin page number | `              ,,table #g4a            #,-` | `              ,,table #g4a           #,-` | not-representable |
| sample-16-09 | 10 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list) | `,rank ,life ev5t                   value` | `,rank  ,life ev5t                 value` | not-representable |
| sample-16-09 | 11 | 2→1 collapse | table separation line | `"3333 "333333333333333333333333 "33333` | `"3333  "333333333333333333333333  "33333` | not-representable |
| sample-16-09 | 12 | 2→1 collapse | column gap after guide dots | `#a "" ,d1? ( sp\se """""""""""" #ajj` | `#a ""  ,d1? ( sp\se """"""""""""  #ajj` | not-representable |
| sample-16-09 | 13 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap after guide dots | `#b "" ,divorce """"""""""""""""     #gc` | `#b ""  ,divorce """"""""""""""""   #gc` | not-representable |
| sample-16-09 | 14 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap after guide dots | `#c "" ,m>ital sep>a;n """""""""     #fe` | `#c ""  ,m>ital sep>a;n """""""""   #fe` | not-representable |
| sample-16-09 | 15 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap after guide dots | `#d "" ,jail t]m """""""""""""""     #fc` | `#d ""  ,jail t]m """""""""""""""   #fc` | not-representable |
| sample-16-09 | 16 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `#e "" ,d1? ( close family memb]     #fc` | `#e ""  ,d1? ( close family memb]   #fc` | not-representable |
| sample-16-09 | 17 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap (table / related columns / columned list); column gap after guide dots | `#f "" ,p]sonal 9jury or ill;s       #ec` | `#f ""  ,p]sonal 9jury or ill;s     #ec` | not-representable |
| sample-16-09 | 18 | 2→1 collapse, compensated by +1 in a later gap/lead | column gap after guide dots | `#g "" ,m>riage """"""""""""""""     #ej"9` | `#g ""  ,m>riage """"""""""""""""   #ej"9` | not-representable |
| sample-16-10 | 0 | gold line too wide | leading indentation / centring | `              ,ma9 ,products ( !        #,-` | `           ,ma9 ,products ( !        #,-` | not-representable |
| sample-16-11 | 0 | gold line too wide | before right-margin page number | `                 ,notes              #gbg` | `                 ,notes             #gbg` | mismatch |
| sample-16-12 | 18 | gold line too wide | before right-margin page number | `777777777777777777777777777777777    a#,-` | `777777777777777777777777777777777   a#,-` | not-representable |
| BANA Example 19-5 | 1 | other misplaced run | code/puzzle spacing | `w s f l      o   w   e   r   l   l` | `w s f l o w e r l l` | mismatch |
| BANA Example 19-5 | 2 | other misplaced run | code/puzzle spacing | `q q f n      w   w   i   o   y   w` | `q q f n w w i o y w` | mismatch |
| BANA Example 19-5 | 3 | other misplaced run | code/puzzle spacing | `t y o b      h   a   x   s   q   k` | `t y o b h a x s q k` | mismatch |
| BANA Example 19-5 | 4 | other misplaced run | code/puzzle spacing | `j u e e      a   g   b   e   r   s` | `j u e e a g b e r s` | mismatch |
| BANA Example 19-5 | 5 | other misplaced run | code/puzzle spacing | `m u g p      p   e   l   r   s   a` | `m u g p p e l r s a` | mismatch |
| BANA Sample 19-1 | 0 | gold line too wide | before right-margin page number | `         ,,symbolically ,,sp1k+       #,-` | `         ,,symbolically ,,sp1k+      #,-` | not-representable |
| BANA Sample 19-2 | 9 | 2→1 collapse | code/puzzle spacing | ` a b c d e f g h i j k l m n o` | ` a  b  c  d  e  f  g  h  i j k l m n o` | not-representable |
| BANA Sample 19-3 | 0 | gold line too wide | before right-margin page number | `    ,decode ! ^ws f yr spell+ li/     #,-` | `    ,decode ! ^ws f yr spell+ li/    #,-` | not-representable |
| BANA Sample 19-3 | 6 | gold line too wide | code/puzzle spacing | `,,code    q w e r t y u i o p a s d f g h` | `,,code   q w e r t y u i o p a s d f g h` | not-representable |
| BANA Sample 19-3 | 9 | other misplaced run | code/puzzle spacing | `,,code    j k l z x c v b n m` | `,,code   j k l z x c v b n m` | not-representable |
| BANA Sample 19-4 | 14 | 2→1 collapse, compensated by +1 in a later gap/lead | code/puzzle spacing | `k   e   y         c a k     e` | `k   e   y         c  a  k   e` | not-representable |
| BANA Sample 19-4 | 17 | 2→1 collapse, compensated by +1 in a later gap/lead | code/puzzle spacing | `b   a g          f   i   s h` | `b   a  g         f   i   s  h` | not-representable |
| BANA Sample 19-4 | 20 | 2→1 collapse, compensated by +1 in a later gap/lead | code/puzzle spacing | ` h o s     e      n a    i l` | ` h  o  s   e      n  a   i  l` | not-representable |
| BANA Sample 19-4 | 23 | 2→1 collapse, compensated by +1 in a later gap/lead | code/puzzle spacing | `c l    o w    n   t r   e e` | `c  l   o  w   n   t r   e  e` | not-representable |
| BANA Sample 19-4 | 24 | 2→1 collapse | code/puzzle spacing | `.--.--#af-.--#b #g-.--#ab-#i` | `.--.--#af-.--#b  #g-.--#ab-#i` | not-representable |
| BANA Sample 19-4 | 26 | 2→1 collapse, compensated by +1 in a later gap/lead | code/puzzle spacing | ` t e    n t` | ` t  e   n  t` | not-representable |
| BANA Sample 19-5 | 25 | 2→1 collapse | code/puzzle spacing | `#a ===-=======` | `#a  ===-=======` | not-representable |
| BANA Sample 19-5 | 26 | 2→1 collapse | code/puzzle spacing | `#b =-----==-==` | `#b  =-----==-==` | not-representable |
| BANA Sample 19-5 | 27 | 2→1 collapse | code/puzzle spacing | `#c ===-====-==` | `#c  ===-====-==` | not-representable |
| BANA Sample 19-5 | 28 | 2→1 collapse | code/puzzle spacing | `#d ===-====-==` | `#d  ===-====-==` | not-representable |
| BANA Sample 19-5 | 29 | 2→1 collapse | code/puzzle spacing | `#e ==-------==` | `#e  ==-------==` | not-representable |
| BANA Sample 19-5 | 30 | 2→1 collapse | code/puzzle spacing | `#f ===-=======` | `#f  ===-=======` | not-representable |
| BANA Sample 19-5 | 31 | 2→1 collapse | code/puzzle spacing | `#g =-=------==` | `#g  =-=------==` | not-representable |
| BANA Sample 19-5 | 32 | 2→1 collapse | code/puzzle spacing | `#h ----===-===` | `#h  ----===-===` | not-representable |
| BANA Sample 19-5 | 33 | 2→1 collapse | code/puzzle spacing | `#i =-=====-===` | `#i  =-=====-===` | not-representable |
| BANA Sample 19-6 | 0 | 2→1 collapse, compensated by +1 in a later gap/lead | code/puzzle spacing | `whiskers small                       #,-` | `whiskers  small                      #,-` | not-representable |
| BANA Sample 19-6 | 10 | 2→1 collapse | code/puzzle spacing | ` kf gh` | ` kf  gh` | not-representable |
| BANA Sample 19-6 | 16 | 2→1 collapse | code/puzzle spacing | ` hhan cheesehwyhlj` | ` hhan  cheesehwyhlj` | not-representable |
| sample-20-04 | 0 | gold line too wide | before right-margin page number | `7777777777777777777777777777777777      #,-` | `7777777777777777777777777777777777   #,-` | not-representable |
| BANA Example 21-11 | 0 | gold line too wide | before right-margin page number | `              keep "<3t4">                            #,-` | `              keep "<3t4">           #,-` | not-representable |
| BANA Example 21-8 | 0 | gold line too wide | before right-margin page number | `               9f],-9h]it                           #cca` | `               9f],-9h]it           #cca` | not-representable |
| BANA Example 21-8 | 2 | gold line too wide | before right-margin page number | `               9f]_49h]it                           #cca` | `               9f]_49h]it           #cca` | not-representable |
| BANA Example 21-8 | 4 | gold line too wide | before right-margin page number | `              9f];\o9h]it                           #cca` | `              9f];\o9h]it           #cca` | not-representable |
| BANA Example 21-8 | 6 | gold line too wide | before right-margin page number | `               9f] _\ 9h]it                         #cca` | `               9f] _\ 9h]it         #cca` | not-representable |
| BANA Example 21-9 | 0 | gold line too wide | before right-margin page number | `           aborig9al,--agogy                           #,-` | `           aborig9al,--agogy         #,-` | not-representable |
| BANA Sample 21-1 | 0 | gold line too wide | before right-margin page number | `      ,gloss>y ( ,botanical ,t]ms    #ajb` | `      ,gloss>y ( ,botanical ,t]ms   #ajb` | mismatch |
| BANA Sample 21-1 | 24 | gold line too wide | before right-margin page number | `          ,appress$,-,ligule          #,-` | `          ,appress$,-,ligule         #,-` | mismatch |
| BANA Sample 21-8 | 24 | gold line too wide | before right-margin page number | `         ,p>adox,-,p]sonifica;n       #,-` | `         ,p>adox,-,p]sonifica;n      #,-` | not-representable |