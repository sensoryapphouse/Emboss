// Document model for UKAAF corpus Sample 3 ("WWF Press Release"), built from
// corpus/ukaaf/sample3-print.pdf. Notes:
//  - Gold bolds the dateline word "WASHINGTON" (^1 bold-word indicator);
//    OUT-OF-SCOPE (typeform, R15).
//  - "For media inquiries, contact:..." and "Notes to editors:..." are
//    modelled as plain paragraphs (3-1); gold sets them off with the same
//    3-1 paragraph shape so this is a like-for-like structural match.
export function sample3() {
  return {
    title: 'WWF Press Release',
    blocks: [
      { type: 'title', text: 'WWF Press Release' },
      { type: 'title', text: 'Switching to Clean Energy Will Stop Great Barrier Reef Destruction from Global Warming, Says WWF' },
      { type: 'para', text: 'For media inquiries, contact: Kathleen Sullivan' },
      { type: 'para', text: 'kathleen.sullivan@wwfus.org' },
      { type: 'para', text: '202-778-9576' },
      { type: 'para', text: 'WASHINGTON – A new World Wildlife Fund report shows that the corals of the Great Barrier Reef may continue to degrade over the coming decades if the world fails to reduce carbon dioxide emissions by rapidly switching to clean, renewable energy sources and limiting CO2 emissions.' },
      { type: 'para', text: '“Coral reefs are one of the first major casualties of climate change,” said Professor Ove Hoegh-Guldberg, University of Queensland Professor, renowned coral reef expert and co-author of the WWF report. “The only hope we have of saving these beautiful ecosystems lies in massively reducing heat-trapping gas emissions and stabilizing the earth’s climate within 2 degrees Celsius of pre-industrial levels.”' },
      { type: 'para', text: 'The WWF report, The Implications of Climate Change for Australia’s Great Barrier Reef, warns that the frequency and severity of coral bleaching caused by global warming will increase world-wide in the coming years. Coral bleaching negatively impacts the biologically diverse ecosystems of coral reefs which are not only beautiful but are also crucial to human economies and food supplies. Depending on its extent, an episode of coral bleaching can dramatically damage or even lead to the death of a reef.' },
      { type: 'para', text: 'The report says that the Great Barrier Reef can recover in the next century if global warming stays below 2 degrees Celsius or approximately 3.6 degrees Fahrenheit. This substantiates the UN Intergovernmental Panel on Climate Change (IPCC) finding that only by keeping global average temperature change to below 2 degrees Celsius will coral reefs like the Great Barrier Reef have any chance of recovering from such damage. Damage control can be achieved by limiting CO2 emissions and replacing oil and coal-based energy with clean, renewable energy sources. According to the report, under the worst case scenario, coral populations will collapse by 2100 and the re-establishment of coral reefs will be highly unlikely over the following 200-500 years.' },
      { type: 'para', text: 'Urgent introduction of better coastal management control, and stricter control of already well-managed fisheries, are also key to improving the ecological resilience of the Great Barrier Reef to survive the damaging impacts of global warming.' },
      { type: 'para', text: 'Carbon dioxide emissions, caused by the burning of dirty fossil fuels like coal, oil, and gas, build up in the atmosphere, blanket the Earth and trap in heat, causing global warming. Electricity production is responsible for about 40% of U.S. CO2 emissions. According to a previous WWF analysis, the U.S. power sector can significantly cut its CO2 emissions that contribute to global warming nearly 60% by 2020 and reduce its dependency on dirty fossil fuels by using available energy technologies and supporting innovative polices. Recently, five electric power companies from across the United States answered a challenge from World Wildlife Fund to become the first U.S. power companies to support a mandatory cap on heat-trapping CO2 emissions and confirm their commitment to clean energy.' },
      { type: 'para', text: '“World Wildlife Fund’s work demonstrates that electric power companies and businesses can reduce their heat-trapping CO2 emissions in a way that makes good business sense,” said Rebecca Eaton, director of Private Sector Initiatives, Climate Change Program, World Wildlife Fund. “To save beautiful, life-sustaining coral reefs and our wild world, it’s critical that policymakers act now to limit carbon pollution and ensure significant emissions reductions.”' },
      { type: 'para', text: 'When corals are exposed to stressful conditions, they bleach – losing the colorful symbiotic algae necessary to their continued health and survival. Coral bleaching can occur when coral are exposed to water temperatures above their normal thermal maxima – an increase of as little as 1 or 2 degrees Celsius or approximately 1.8 or 3.6 degrees Fahrenheit.' },
      { type: 'para', text: 'The Great Barrier Reef Marine Park Authority, the agency that manages the Reef, has warned that the first-ever coral bleaching event outside of El Niño may take place on the Reef within the next few weeks.' },
      { type: 'para', text: 'Notes to editors: To contact the WWF report authors through WWF-Australia, contact: Imogen Zethoven, WWF-Australia Great Barrier Reef Campaign, Tel. +61 7 3839 2677, izethoven@wwf.org.au.' },
      { type: 'para', text: 'Electricity production accounts for 37 percent of global CO2 emissions. World Coal Institute, 2003; International Energy Agency, 2003.' },
      { type: 'para', text: 'Based on the UN Intergovernmental Panel on Climate Change (IPCC) findings, WWF and other environmental groups have determined the danger threshold of global warming to be at 2 degrees Celsius above pre-industrial levels. So far, global average warming stands at 0.6 degrees Celsius, with current emissions of heat-trapping gas higher than any time before. (For more information, see http://www.ipcc.ch.)' },
    ],
  };
}
